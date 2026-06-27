import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import fs from 'fs';
import path from 'path';
import { IContentItem } from '../models/Site';

// Tags we never want to touch
const SKIP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'noscript', 'head', 'svg', 'path',
  'g', 'defs', 'symbol', 'use', 'template', 'iframe', 'canvas', 'object',
  'input', 'select', 'textarea', 'option', 'code', 'pre',
]);

// Human-readable label per tag
const TAG_LABEL: Record<string, [baseKey: string, label: string]> = {
  h1: ['h1', 'Main Heading'],
  h2: ['h2', 'Section Heading'],
  h3: ['h3', 'Sub Heading'],
  h4: ['h4', 'Heading'],
  h5: ['heading', 'Heading'],
  h6: ['heading', 'Heading'],
  p:  ['paragraph', 'Paragraph'],
  a:  ['link', 'Link'],
  button: ['button', 'Button'],
  li: ['list_item', 'List Item'],
  span: ['span', 'Text'],
  div:  ['div', 'Content'],
  td:   ['td', 'Table Cell'],
  th:   ['th', 'Table Header'],
  label: ['label', 'Label'],
  strong: ['strong', 'Bold Text'],
  em: ['em', 'Italic Text'],
  b:  ['b', 'Bold Text'],
};

export interface ParseResult {
  instrumentedHTML: string;
  contentMap: IContentItem[];
  title: string;
}

export function parseAndInstrument(htmlPath: string): ParseResult {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  const contentMap: IContentItem[] = [];
  const counters: Record<string, number> = {};

  const title = $('title').text().trim() || path.basename(htmlPath, '.html');

  function addItem(
    baseKey: string,
    baseLabel: string,
    value: string,
    type: IContentItem['type'],
    $el: cheerio.Cheerio<Element>
  ) {
    // Skip if already instrumented
    if ($el.attr('data-chasqr-key')) return;
    const v = value.trim();
    if (v.length < 2 || v.length > 500) return;

    counters[baseKey] = (counters[baseKey] || 0) + 1;
    const n = counters[baseKey];
    const key = `${baseKey}_${n}`;
    const label = n > 1 ? `${baseLabel} ${n}` : baseLabel;
    $el.attr('data-chasqr-key', key);
    contentMap.push({ key, label, value: v, type });
  }

  // Walk every element in DOM order
  $('*').each((_, el) => {
    const tagName = (el as Element).tagName?.toLowerCase();
    if (!tagName || SKIP_TAGS.has(tagName)) return;

    // Skip elements inside skip-tag containers
    if ($(el).closest(Array.from(SKIP_TAGS).join(',')).length > 0) return;

    const $el = $(el);

    // ── Images (special: no text, use src) ──────────────────────────────
    const $typedEl = $el as unknown as cheerio.Cheerio<Element>;

    if (tagName === 'img') {
      const src = $typedEl.attr('src') || '';
      if (src && !src.startsWith('data:')) {
        addItem('image', 'Image', src, 'image', $typedEl);
      }
      return;
    }

    // ── Only capture TRUE leaf nodes (no child elements at all) ─────────
    // This ensures .text() updates never destroy inner HTML structure.
    if ($el.children().length > 0) return;

    const text = $el.text().trim();
    if (text.length < 2 || text.length > 500) return;

    const [baseKey, baseLabel] = TAG_LABEL[tagName] ?? ['content', 'Content'];
    const type: IContentItem['type'] = tagName === 'a' ? 'link' : 'text';
    addItem(baseKey, baseLabel, text, type, $typedEl);
  });

  return { instrumentedHTML: $.html(), contentMap, title };
}

export function applyUpdates(htmlPath: string, updates: Record<string, string>): void {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);

  for (const [key, value] of Object.entries(updates)) {
    const $el = $(`[data-chasqr-key="${key}"]`);
    if (!$el.length) continue;

    if ($el.is('img')) {
      $el.attr('src', value);
    } else {
      // Safe: these are leaf nodes — no children to lose
      $el.text(value);
    }
  }

  fs.writeFileSync(htmlPath, $.html(), 'utf-8');
}
