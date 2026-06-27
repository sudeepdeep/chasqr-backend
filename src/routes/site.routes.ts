import { Router } from 'express';
import { protect } from '../middleware/auth';
import { uploadZip, uploadFiles } from '../middleware/upload';
import {
  uploadZipSite,
  uploadFilesSite,
  getMySites,
  getSite,
  updateContent,
  updateSlug,
  renameSite,
  toggleStatus,
  deleteSite,
} from '../controllers/site.controller';

const router = Router();

router.use(protect);

router.post('/upload-zip', (req, res, next) => {
  uploadZip(req, res, (err) => {
    if (err) { res.status(400).json({ success: false, message: err.message }); return; }
    next();
  });
}, uploadZipSite);

router.post('/upload-files', (req, res, next) => {
  uploadFiles(req, res, (err) => {
    if (err) { res.status(400).json({ success: false, message: err.message }); return; }
    next();
  });
}, uploadFilesSite);

router.get('/', getMySites);
router.get('/:siteId', getSite);
router.put('/:siteId/content', updateContent);
router.put('/:siteId/slug', updateSlug);
router.put('/:siteId/name', renameSite);
router.put('/:siteId/status', toggleStatus);
router.delete('/:siteId', deleteSite);

export default router;
