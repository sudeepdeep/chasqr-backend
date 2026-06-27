import { Router } from 'express';
import { protect } from '../middleware/auth';
import { uploadZip, uploadFiles } from '../middleware/upload';
import {
  uploadZipSite,
  uploadFilesSite,
  redeployZip,
  redeployFiles,
  getMySites,
  getSite,
  getAnalytics,
  updateContent,
  updateSEO,
  updateSlug,
  renameSite,
  toggleStatus,
  deleteSite,
} from '../controllers/site.controller';

const router = Router();

router.use(protect);

const withZip = (handler: any) => (req: any, res: any, next: any) => {
  uploadZip(req, res, (err) => {
    if (err) { res.status(400).json({ success: false, message: err.message }); return; }
    next();
  });
};

const withFiles = (handler: any) => (req: any, res: any, next: any) => {
  uploadFiles(req, res, (err) => {
    if (err) { res.status(400).json({ success: false, message: err.message }); return; }
    next();
  });
};

// Initial deploy
router.post('/upload-zip',   withZip(uploadZipSite),     uploadZipSite);
router.post('/upload-files', withFiles(uploadFilesSite),  uploadFilesSite);

// Redeploy existing site
router.put('/:siteId/redeploy-zip',   withZip(redeployZip),   redeployZip);
router.put('/:siteId/redeploy-files', withFiles(redeployFiles), redeployFiles);

router.get('/',                getMySites);
router.get('/:siteId',         getSite);
router.get('/:siteId/analytics', getAnalytics);
router.put('/:siteId/content', updateContent);
router.put('/:siteId/seo',     updateSEO);
router.put('/:siteId/slug',    updateSlug);
router.put('/:siteId/name',    renameSite);
router.put('/:siteId/status',  toggleStatus);
router.delete('/:siteId',      deleteSite);

export default router;
