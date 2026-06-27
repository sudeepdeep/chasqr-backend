import { Response } from 'express';
import { User, Site } from '../models';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

export const getAllUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  const users = await User.find().select('-password').sort({ created_at: -1 });
  sendSuccess(res, { users, total: users.length });
};

export const getAllSites = async (_req: AuthRequest, res: Response): Promise<void> => {
  const sites = await Site.find()
    .populate('userId', 'name email')
    .sort({ created_at: -1 });
  sendSuccess(res, { sites, total: sites.length });
};

export const updateUserStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) {
    sendError(res, 'Invalid status. Use active or suspended.');
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.params.userId,
    { status },
    { new: true }
  ).select('-password');

  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }

  sendSuccess(res, { user }, `User ${status}`);
};

export const updateUserRole = async (req: AuthRequest, res: Response): Promise<void> => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    sendError(res, 'Invalid role. Use user or admin.');
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.params.userId,
    { role },
    { new: true }
  ).select('-password');

  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }

  sendSuccess(res, { user }, `User role updated to ${role}`);
};

export const adminDeleteSite = async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await Site.findOne({ siteId: req.params.siteId });
  if (!site) {
    sendError(res, 'Site not found', 404);
    return;
  }

  const fs = await import('fs');
  const path = await import('path');
  const siteDir = path.join(__dirname, '../../storage/sites', site.siteId);
  fs.rmSync(siteDir, { recursive: true, force: true });
  await site.deleteOne();

  sendSuccess(res, null, 'Site deleted by admin');
};

export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  const [totalUsers, totalSites, activeSites] = await Promise.all([
    User.countDocuments(),
    Site.countDocuments(),
    Site.countDocuments({ status: 'active' }),
  ]);

  const totalVisits = (await Site.aggregate([
    { $group: { _id: null, total: { $sum: '$visits' } } },
  ])) as { total: number }[];

  sendSuccess(res, {
    totalUsers,
    totalSites,
    activeSites,
    totalVisits: totalVisits[0]?.total || 0,
  });
};
