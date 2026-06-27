import { Response } from 'express';
import path from 'path';
import AdmZip from 'adm-zip';
import { randomUUID } from 'crypto';
import { Site, SiteFile } from '../models';
import { IPage } from '../models/Site';
import { parseAndInstrumentHTML, applyUpdatesToHTML, applySEOUpdatesToHTML } from '../services/parser.service';
import { getMimeType } from '../utils/mime';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

function sanitizePath(p: string): string {
  return path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, '').replace(/\\/g, '/');
}

const RESERVED_SLUGS = new Set(['api', 'admin', 'www', 'sites', 'health', 'static', 'assets']);

async function resolveSlug(raw: string | undefined, fallback: string): Promise<{ slug: string; error?: string }> {
  if (!raw?.trim()) return { slug: fallback };
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 3) return { slug: '', error: 'Slug must be at least 3 characters' };
  if (slug.length > 50) return { slug: '', error: 'Slug must be 50 characters or less' };
  if (RESERVED_SLUGS.has(slug)) return { slug: '', error: `"${slug}" is a reserved name` };
  const existing = await Site.findOne({ slug });
  if (existing) return { slug: '', error: `"${slug}" is already taken` };
  return { slug };
}

/**
 * Store a list of in-memory files into MongoDB for a given siteId.
 * Parses all HTML files, instruments them, and returns pages array.
 */
async function storeFilesAndBuildPages(
  siteId: string,
  files: { path: string; buffer: Buffer }[]
): Promise<IPage[]> {
  // Delete any existing files for this site first (for re-uploads)
  await SiteFile.deleteMany({ siteId });

  // Separate HTML files from assets
  const htmlFiles: { path: string; buffer: Buffer }[] = [];
  const assetFiles: { path: string; buffer: Buffer }[] = [];

  for (const f of files) {
    if (f.path.toLowerCase().endsWith('.html') || f.path.toLowerCase().endsWith('.htm')) {
      htmlFiles.push(f);
    } else {
      assetFiles.push(f);
    }
  }

  // Sort: index.html first
  htmlFiles.sort((a, b) =>
    a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)
  );

  // Parse & instrument HTML files, then save all to MongoDB
  const pages: IPage[] = [];

  for (const f of htmlFiles) {
    const html = f.buffer.toString('utf-8');
    const { instrumentedHTML, contentMap, title, metaDescription, ogImage, ogTitle, ogDescription } = parseAndInstrumentHTML(html);
    const instrumentedBuffer = Buffer.from(instrumentedHTML, 'utf-8');

    await SiteFile.create({
      siteId,
      path: f.path,
      content: instrumentedBuffer,
      mimeType: getMimeType(f.path),
      size: instrumentedBuffer.length,
    });

    pages.push({
      filename: f.path,
      title: title || f.path,
      contentMap,
      metaDescription,
      ogImage,
      ogTitle,
      ogDescription,
    });
  }

  // Save all asset files
  for (const f of assetFiles) {
    await SiteFile.create({
      siteId,
      path: f.path,
      content: f.buffer,
      mimeType: getMimeType(f.path),
      size: f.buffer.length,
    });
  }

  return pages;
}

// POST /api/sites/upload-zip
export const uploadZipSite = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { sendError(res, 'No zip file uploaded', 400); return; }

  const name = (req.body.name || 'My Site').trim();
  const siteId = randomUUID().split('-')[0];

  const { slug, error: slugError } = await resolveSlug(req.body.slug, siteId);
  if (slugError) { sendError(res, slugError, 400); return; }

  let files: { path: string; buffer: Buffer }[] = [];

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
      files.push({ path: relativePath, buffer: entry.getData() });
    }
  } catch {
    sendError(res, 'Failed to extract zip file', 400);
    return;
  }

  const hasIndex = files.some(f => f.path === 'index.html');
  if (!hasIndex) {
    sendError(res, 'No index.html found in zip. Please include an index.html at the root level.', 400);
    return;
  }

  const pages = await storeFilesAndBuildPages(siteId, files);
  const site = await Site.create({ userId: req.user!.id, siteId, slug, name, pages });
  sendSuccess(res, { site, url: `/sites/${slug}/` }, 'Site deployed successfully', 201);
};

// POST /api/sites/upload-files
export const uploadFilesSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles?.length) { sendError(res, 'No files uploaded', 400); return; }

  const name = (req.body.name || 'My Site').trim();
  const relativePaths: string[] = JSON.parse(req.body.paths || '[]');
  const siteId = randomUUID().split('-')[0];

  const { slug, error: slugError } = await resolveSlug(req.body.slug, siteId);
  if (slugError) { sendError(res, slugError, 400); return; }

  const files = uploadedFiles.map((f, i) => ({
    path: sanitizePath(relativePaths[i] || f.originalname),
    buffer: f.buffer,
  }));

  const hasIndex = files.some(f => f.path === 'index.html');
  if (!hasIndex) {
    sendError(res, 'No index.html found. Please include an index.html file.', 400);
    return;
  }

  const pages = await storeFilesAndBuildPages(siteId, files);
  const site = await Site.create({ userId: req.user!.id, siteId, slug, name, pages });
  sendSuccess(res, { site, url: `/sites/${slug}/` }, 'Site deployed successfully', 201);
};

// PUT /api/sites/:siteId/redeploy-zip
export const redeployZip = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { sendError(res, 'No zip file uploaded', 400); return; }

  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  let files: { path: string; buffer: Buffer }[] = [];

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
      files.push({ path: relativePath, buffer: entry.getData() });
    }
  } catch {
    sendError(res, 'Failed to extract zip file', 400);
    return;
  }

  const hasIndex = files.some(f => f.path === 'index.html');
  if (!hasIndex) { sendError(res, 'No index.html found in zip.', 400); return; }

  const pages = await storeFilesAndBuildPages(site.siteId, files);
  site.pages = pages;
  await site.save();

  sendSuccess(res, { site }, 'Site redeployed successfully');
};

// PUT /api/sites/:siteId/redeploy-files
export const redeployFiles = async (req: AuthRequest, res: Response): Promise<void> => {
  const uploadedFiles = req.files as Express.Multer.File[];
  if (!uploadedFiles?.length) { sendError(res, 'No files uploaded', 400); return; }

  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  const relativePaths: string[] = JSON.parse(req.body.paths || '[]');
  const files = uploadedFiles.map((f, i) => ({
    path: sanitizePath(relativePaths[i] || f.originalname),
    buffer: f.buffer,
  }));

  const hasIndex = files.some(f => f.path === 'index.html');
  if (!hasIndex) { sendError(res, 'No index.html found.', 400); return; }

  const pages = await storeFilesAndBuildPages(site.siteId, files);
  site.pages = pages;
  await site.save();

  sendSuccess(res, { site }, 'Site redeployed successfully');
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
export const updateContent = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  const { page: filename, updates } = req.body as { page: string; updates: Record<string, string> };
  if (!filename || !updates) { sendError(res, 'page and updates are required', 400); return; }

  const pageEntry = site.pages.find(p => p.filename === filename);
  if (!pageEntry) { sendError(res, `Page "${filename}" not found`, 404); return; }

  // Load HTML from MongoDB
  const siteFile = await SiteFile.findOne({ siteId: site.siteId, path: filename });
  if (!siteFile) { sendError(res, 'HTML file not found in database', 500); return; }

  // Apply updates in memory
  const updatedHTML = applyUpdatesToHTML(siteFile.content.toString('utf-8'), updates);
  siteFile.content = Buffer.from(updatedHTML, 'utf-8');
  siteFile.size = siteFile.content.length;
  await siteFile.save();

  // Update contentMap values in DB
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
  await SiteFile.deleteMany({ siteId: site.siteId });
  await site.deleteOne();
  sendSuccess(res, null, 'Site deleted');
};

// PUT /api/sites/:siteId/seo
export const updateSEO = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page: filename, title, metaDescription, ogImage, ogTitle, ogDescription } = req.body;
  if (!filename) { sendError(res, 'page is required', 400); return; }

  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  const pageEntry = site.pages.find(p => p.filename === filename);
  if (!pageEntry) { sendError(res, `Page "${filename}" not found`, 404); return; }

  // Load HTML from MongoDB
  const siteFile = await SiteFile.findOne({ siteId: site.siteId, path: filename });
  if (!siteFile) { sendError(res, 'HTML file not found in database', 500); return; }

  // Apply SEO updates to HTML
  const html = siteFile.content.toString('utf-8');
  const seoUpdates = {
    title: title || pageEntry.title,
    metaDescription: metaDescription !== undefined ? metaDescription : pageEntry.metaDescription,
    ogImage: ogImage !== undefined ? ogImage : pageEntry.ogImage,
    ogTitle: ogTitle !== undefined ? ogTitle : pageEntry.ogTitle,
    ogDescription: ogDescription !== undefined ? ogDescription : pageEntry.ogDescription,
  };

  const updatedHTML = applySEOUpdatesToHTML(html, seoUpdates);
  siteFile.content = Buffer.from(updatedHTML, 'utf-8');
  siteFile.size = siteFile.content.length;
  await siteFile.save();

  // Update SEO data in Site document
  pageEntry.title = seoUpdates.title;
  pageEntry.metaDescription = seoUpdates.metaDescription;
  pageEntry.ogImage = seoUpdates.ogImage;
  pageEntry.ogTitle = seoUpdates.ogTitle;
  pageEntry.ogDescription = seoUpdates.ogDescription;
  await site.save();

  sendSuccess(res, { site }, 'SEO updated and deployed');
};

// GET /api/sites/:siteId/analytics
export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId as string, userId: req.user!.id });
  if (!site) { sendError(res, 'Site not found', 404); return; }

  // Get last 30 days of visit data
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentVisits = site.visitHistory.filter(date => date >= thirtyDaysAgo);

  // Group visits by date (YYYY-MM-DD)
  const dailyVisits: Record<string, number> = {};
  for (let i = 29; i >= 0; i--) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    dailyVisits[dateStr] = 0;
  }

  recentVisits.forEach(date => {
    const dateStr = date.toISOString().split('T')[0];
    dailyVisits[dateStr] = (dailyVisits[dateStr] || 0) + 1;
  });

  // Convert to array for chart
  const chartData = Object.entries(dailyVisits).map(([date, count]) => ({
    date,
    visits: count,
  }));

  sendSuccess(res, {
    total: site.visits,
    last30Days: recentVisits.length,
    chartData,
  });
};
