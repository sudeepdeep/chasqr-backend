import { Router } from 'express';
import { protect } from '../middleware/auth';
import { adminOnly } from '../middleware/adminOnly';
import {
  getAllUsers,
  getAllSites,
  updateUserStatus,
  updateUserRole,
  adminDeleteSite,
  getStats,
} from '../controllers/admin.controller';

const router = Router();

router.use(protect, adminOnly);

router.get('/stats', getStats);
router.get('/users', getAllUsers);
router.get('/sites', getAllSites);
router.put('/users/:userId/status', updateUserStatus);
router.put('/users/:userId/role', updateUserRole);
router.delete('/sites/:siteId', adminDeleteSite);

export default router;
