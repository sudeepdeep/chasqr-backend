import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { sendError } from '../utils/response';
import { User } from '../models';

export interface AuthRequest extends Request {
  user?: { id: string };
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'No token provided', 401);
    return;
  }

  const token = authHeader.split(' ')[1];

  const decoded = verifyToken(token);
  const user = await User.findById(decoded.id).select('-password');

  if (!user) {
    sendError(res, 'User not found', 401);
    return;
  }

  if (user.status === 'suspended') {
    sendError(res, 'Account suspended. Please contact support.', 403);
    return;
  }

  req.user = { id: (user._id as { toString(): string }).toString() };
  next();
};
