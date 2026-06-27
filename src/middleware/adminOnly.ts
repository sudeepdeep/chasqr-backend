import { Response, NextFunction } from 'express';
import { User } from '../models';
import { sendError } from '../utils/response';
import { AuthRequest } from './auth';

export const adminOnly = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const user = await User.findById(req.user?.id).select('role');
  if (!user || user.role !== 'admin') {
    sendError(res, 'Admin access required', 403);
    return;
  }
  next();
};
