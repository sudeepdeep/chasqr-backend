import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { IContentItem } from '../models/Site';

// Tags we never want to touch
const SKIP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'noscript', 'head', 'svg', 'path',
  'g', 'defs', 'symbol', 'use', 'template', 'iframe', 'canvas', 'object',
  'input', 'select', 'textarea', 'option', 'code', 'pre',
]);

const TAG_LABEL: Record<string, [string, string]> = {
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
  metaDescription: string;
  ogImage: string;
  ogTitle: string;
  ogDescription: string;
}

/**
 * Parse an HTML string, inject data-chasqr-key attributes on editable elements,
 * and return the modified HTML + content map.
 */
export function parseAndInstrumentHTML(html: string): ParseResult {
  const $ = cheerio.load(html);
  const contentMap: IContentItem[] = [];
  const counters: Record<string, number> = {};
  const title = $('title').text().trim() || 'Untitled';

  // Extract SEO metadata
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const ogImage = $('meta[property="og:image"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription = $('meta[property="og:description"]').attr('content') || '';

  function addItem(
    baseKey: string,
    baseLabel: string,
    value: string,
    type: IContentItem['type'],
    $el: cheerio.Cheerio<Element>
  ) {
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

  $('*').each((_, el) => {
    const tagName = (el as Element).tagName?.toLowerCase();
    if (!tagName || SKIP_TAGS.has(tagName)) return;
    if ($(el).closest(Array.from(SKIP_TAGS).join(',')).length > 0) return;

    const $el = $(el);
    const $typedEl = $el as unknown as cheerio.Cheerio<Element>;

    if (tagName === 'img') {
      const src = $typedEl.attr('src') || '';
      if (src && !src.startsWith('data:')) addItem('image', 'Image', src, 'image', $typedEl);
      return;
    }

    if ($el.children().length > 0) return;

    const text = $el.text().trim();
    if (text.length < 2 || text.length > 500) return;

    const [baseKey, baseLabel] = TAG_LABEL[tagName] ?? ['content', 'Content'];
    const type: IContentItem['type'] = tagName === 'a' ? 'link' : 'text';
    addItem(baseKey, baseLabel, text, type, $typedEl);
  });

  return { instrumentedHTML: $.html(), contentMap, title, metaDescription, ogImage, ogTitle, ogDescription };
}

/**
 * Apply content updates to an HTML string and return the modified HTML.
 */
export function applyUpdatesToHTML(html: string, updates: Record<string, string>): string {
  const $ = cheerio.load(html);

  for (const [key, value] of Object.entries(updates)) {
    const $el = $(`[data-chasqr-key="${key}"]`);
    if (!$el.length) continue;
    if ($el.is('img')) {
      $el.attr('src', value);
    } else {
      $el.text(value);
    }
  }

  return $.html();
}

/**
 * Apply SEO metadata updates to HTML (title, meta description, OG tags).
 */
export function applySEOUpdatesToHTML(
  html: string,
  updates: { title?: string; metaDescription?: string; ogImage?: string; ogTitle?: string; ogDescription?: string }
): string {
  const $ = cheerio.load(html);

  // Update page title
  if (updates.title) {
    let $title = $('title');
    if ($title.length === 0) {
      $('head').prepend('<title></title>');
      $title = $('title');
    }
    $title.text(updates.title);
  }

  // Helper to set meta tag
  const setMetaTag = (name: string, attr: string, value: string) => {
    let $meta = $(`meta[${attr}="${name}"]`);
    if ($meta.length === 0) {
      $('head').append(`<meta ${attr}="${name}" content="">`);
      $meta = $(`meta[${attr}="${name}"]`);
    }
    $meta.attr('content', value);
  };

  if (updates.metaDescription) setMetaTag('description', 'name', updates.metaDescription);
  if (updates.ogImage) setMetaTag('og:image', 'property', updates.ogImage);
  if (updates.ogTitle) setMetaTag('og:title', 'property', updates.ogTitle);
  if (updates.ogDescription) setMetaTag('og:description', 'property', updates.ogDescription);

  return $.html();
}
