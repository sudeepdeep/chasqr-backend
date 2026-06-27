import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { v4 as uuidv4 } from 'uuid';
import { Site } from '../models';
import { IPage } from '../models/Site';
import { parseAndInstrument, applyUpdates } from '../services/parser.service';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

const STORAGE_PATH = path.join(__dirname, '../../storage/sites');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitizePath(p: string): string {
  return path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, '');
}

const RESERVED_SLUGS = new Set(['api', 'admin', 'www', 'sites', 'health', 'static', 'assets']);

async function resolveSlug(raw: string | undefined, fallback: string): Promise<{ slug: string; error?: string }> {
  if (!raw || !raw.trim()) return { slug: fallback };

  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  if (slug.length < 3) return { slug: '', error: 'Slug must be at least 3 characters' };
  if (slug.length > 50) return { slug: '', error: 'Slug must be 50 characters or less' };
  if (RESERVED_SLUGS.has(slug)) return { slug: '', error: `"${slug}" is a reserved name` };

  const existing = await Site.findOne({ slug });
  if (existing) return { slug: '', error: `"${slug}" is already taken` };

  return { slug };
}

// Recursively find all .html files relative to baseDir
function findHTMLFiles(dir: string, baseDir: string = dir): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findHTMLFiles(fullPath, baseDir));
    } else if (entry.name.toLowerCase().endsWith('.html')) {
      results.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  // index.html always first
  return results.sort((a, b) =>
    a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)
  );
}

// Parse all HTML files in siteDir and return pages array
function buildPages(siteDir: string): IPage[] {
  const htmlFiles = findHTMLFiles(siteDir);
  const pages: IPage[] = [];

  for (const filename of htmlFiles) {
    const htmlPath = path.join(siteDir, filename);
    const { instrumentedHTML, contentMap, title } = parseAndInstrument(htmlPath);
    fs.writeFileSync(htmlPath, instrumentedHTML, 'utf-8');
    pages.push({ filename, title: title || filename, contentMap });
  }

  return pages;
}

// POST /api/sites/upload-zip
export const uploadZipSite = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { sendError(res, 'No zip file uploaded', 400); return; }

  const name = (req.body.name || 'My Site').trim();
  const siteId = uuidv4().split('-')[0];

  const { slug, error: slugError } = await resolveSlug(req.body.slug, siteId);
  if (slugError) { sendError(res, slugError, 400); return; }

  const siteDir = path.join(STORAGE_PATH, siteId);
  ensureDir(siteDir);

  try {
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    const rootDirs = new Set(entries.map(e => e.entryName.split('/')[0]));
    const hasSingleRoot = rootDirs.size === 1 && entries.every(e => e.entryName.includes('/'));
    const stripPrefix = hasSingleRoot ? [...rootDirs][0] + '/' : '';

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      let relativePath = entry.entryName;
      if (stripPrefix && relativePath.startsWith(stripPrefix)) {
        relativePath = relativePath.slice(stripPrefix.length);
      }
      relativePath = sanitizePath(relativePath);
      if (!relativePath) continue;
      const destPath = path.join(siteDir, relativePath);
      ensureDir(path.dirname(destPath));
      fs.writeFileSync(destPath, entry.getData());
    }
  } catch {
    fs.rmSync(siteDir, { recursive: true, force: true });
    sendError(res, 'Failed to extract zip file', 400);
    return;
  }

  const indexPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.rmSync(siteDir, { recursive: true, force: true });
    sendError(res, 'No index.html found in zip. Please include an index.html at the root level.', 400);
    return;
  }

  const pages = buildPages(siteDir);
  const site = await Site.create({ userId: req.user!.id, siteId, slug, name, pages });
  sendSuccess(res, { site, url: `/sites/${slug}/` }, 'Site deployed successfully', 201);
};

// POST /api/sites/upload-files
export const uploadFilesSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { sendError(res, 'No files uploaded', 400); return; }

  const name = (req.body.name || 'My Site').trim();
  const relativePaths: string[] = JSON.parse(req.body.paths || '[]');
  const siteId = uuidv4().split('-')[0];

  const { slug, error: slugError } = await resolveSlug(req.body.slug, siteId);
  if (slugError) { sendError(res, slugError, 400); return; }
  const siteDir = path.join(STORAGE_PATH, siteId);
  ensureDir(siteDir);

  for (let i = 0; i < files.length; i++) {
    const relPath = sanitizePath(relativePaths[i] || files[i].originalname);
    const destPath = path.join(siteDir, relPath);
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, files[i].buffer);
  }

  const indexPath = path.join(siteDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fs.rmSync(siteDir, { recursive: true, force: true });
    sendError(res, 'No index.html found. Please include an index.html file.', 400);
    return;
  }

  const pages = buildPages(siteDir);
  const site = await Site.create({ userId: req.user!.id, siteId, slug, name, pages });
  sendSuccess(res, { site, url: `/sites/${slug}/` }, 'Site deployed successfully', 201);
};

// GET /api/sites
export const getMySites = async (req: AuthRequest, res: Response): Promise<void> => {
  const sites = await Site.find({ userId: req.user!.id }).sort({ created_at: -1 });
  sendSuccess(res, { sites });
};

// GET /api/sites/:siteId
export const getSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }
  sendSuccess(res, { site });
};

// PUT /api/sites/:siteId/content
// Body: { page: 'index.html', updates: { key: value } }
export const updateContent = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  const { page: filename, updates } = req.body as { page: string; updates: Record<string, string> };

  if (!filename || !updates) {
    sendError(res, 'page and updates are required', 400);
    return;
  }

  const pageEntry = site.pages.find(p => p.filename === filename);
  if (!pageEntry) { sendError(res, `Page "${filename}" not found`, 404); return; }

  const htmlPath = path.join(STORAGE_PATH, site.siteId, filename);
  if (!fs.existsSync(htmlPath)) { sendError(res, 'HTML file not found on server', 500); return; }

  applyUpdates(htmlPath, updates);

  for (const item of pageEntry.contentMap) {
    if (updates[item.key] !== undefined) item.value = updates[item.key];
  }
  await site.save();

  sendSuccess(res, { site }, 'Content updated and deployed');
};

// PUT /api/sites/:siteId/slug
export const updateSlug = async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug: rawSlug } = req.body;
  if (!rawSlug?.trim()) { sendError(res, 'Slug is required'); return; }

  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  // Validate + check uniqueness, excluding this site itself
  const slug = rawSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 3) { sendError(res, 'Slug must be at least 3 characters', 400); return; }
  if (slug.length > 50) { sendError(res, 'Slug must be 50 characters or less', 400); return; }
  if (RESERVED_SLUGS.has(slug)) { sendError(res, `"${slug}" is a reserved name`, 400); return; }

  const conflict = await Site.findOne({ slug, _id: { $ne: site._id } });
  if (conflict) { sendError(res, `"${slug}" is already taken`, 409); return; }

  site.slug = slug;
  await site.save();
  sendSuccess(res, { site, url: `/sites/${slug}/` }, 'URL updated');
};

// PUT /api/sites/:siteId/name
export const renameSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name?.trim()) { sendError(res, 'Name is required'); return; }

  const site = await Site.findOneAndUpdate(
    { siteId: req.params.siteId as string, userId: req.user!.id },
    { name: name.trim() },
    { new: true }
  );
  if (!site) { sendError(res, 'Site not found', 404); return; }
  sendSuccess(res, { site }, 'Site renamed');
};

// PUT /api/sites/:siteId/status
export const toggleStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }
  site.status = site.status === 'active' ? 'inactive' : 'active';
  await site.save();
  sendSuccess(res, { site }, `Site is now ${site.status}`);
};

// DELETE /api/sites/:siteId
export const deleteSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }
  fs.rmSync(path.join(STORAGE_PATH, site.siteId), { recursive: true, force: true });
  await site.deleteOne();
  sendSuccess(res, null, 'Site deleted');
};
