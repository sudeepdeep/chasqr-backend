import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Resend } from 'resend';
import { User } from '../models';
import { signToken } from '../utils/jwt';
import { sendSuccess, sendError } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const resend = new Resend(process.env.RESEND_API_KEY);

const formatUser = (user: InstanceType<typeof User>) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  plan: user.plan,
  status: user.status,
  email_verified: user.email_verified,
  created_at: user.created_at,
});

export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    sendError(res, 'Email already registered', 409);
    return;
  }

  const user = await User.create({ name, email, password });
  const token = signToken((user._id as { toString(): string }).toString());
  sendSuccess(res, { user: formatUser(user), token }, 'Account created successfully', 201);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    sendError(res, 'Invalid email or password', 401);
    return;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    sendError(res, 'Invalid email or password', 401);
    return;
  }

  if (user.status === 'suspended') {
    sendError(res, 'Account suspended. Please contact support.', 403);
    return;
  }

  const token = signToken((user._id as { toString(): string }).toString());
  sendSuccess(res, { user: formatUser(user), token }, 'Login successful');
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  const { credential } = req.body;

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) {
    sendError(res, 'Invalid Google token', 401);
    return;
  }

  let user = await User.findOne({ email: payload.email });

  if (!user) {
    user = await User.create({
      name: payload.name || payload.email.split('@')[0],
      email: payload.email,
      password: Math.random().toString(36).slice(-12) + 'Aa1!',
      email_verified: true,
    });
  }

  if (user.status === 'suspended') {
    sendError(res, 'Account suspended. Please contact support.', 403);
    return;
  }

  const token = signToken((user._id as { toString(): string }).toString());
  sendSuccess(res, { user: formatUser(user), token }, 'Login successful');
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.user?.id).select('-password');
  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }
  sendSuccess(res, { user: formatUser(user) });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const { name } = req.body;
  if (!name) {
    sendError(res, 'Name is required');
    return;
  }

  const user = await User.findByIdAndUpdate(
    req.user?.id,
    { name },
    { new: true, runValidators: true }
  ).select('-password');

  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }

  sendSuccess(res, { user: formatUser(user) }, 'Profile updated successfully');
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    sendError(res, 'current_password and new_password are required');
    return;
  }

  if (new_password.length < 8) {
    sendError(res, 'New password must be at least 8 characters');
    return;
  }

  const user = await User.findById(req.user?.id);
  if (!user) {
    sendError(res, 'User not found', 404);
    return;
  }

  const isMatch = await user.comparePassword(current_password);
  if (!isMatch) {
    sendError(res, 'Current password is incorrect', 401);
    return;
  }

  user.password = new_password;
  await user.save();

  sendSuccess(res, null, 'Password changed successfully');
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    sendError(res, 'Email is required');
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set');
    sendError(res, 'Email service not configured', 500);
    return;
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+resetPasswordToken +resetPasswordExpires');
  if (!user) {
    // Don't reveal if email exists
    sendSuccess(res, null, 'If email exists, reset link has been sent');
    return;
  }

  // Generate reset token
  const token = randomBytes(32).toString('hex');
  user.resetPasswordToken = token;
  user.resetPasswordExpires = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour
  await user.save();

  // Send email
  const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  try {
    const result = await resend.emails.send({
      from: 'noreply@chasqr.com',
      to: user.email,
      subject: 'Password Reset Request — Chasqr',
      html: `
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display:inline-block; background:#2563eb; color:white; padding:10px 20px; border-radius:6px; text-decoration:none; font-weight:600;">Reset Password</a>
        <p style="margin-top:20px; color:#666; font-size:14px;">If you didn't request this, ignore this email.</p>
      `,
    });

    if (result.error) {
      console.error('Resend error:', result.error);
      sendError(res, `Failed to send email: ${result.error.message || 'Unknown error'}`, 500);
      return;
    }

    sendSuccess(res, null, 'Password reset link sent to your email');
  } catch (err: any) {
    console.error('Failed to send reset email:', err);
    sendError(res, `Email service error: ${err.message || 'Failed to send email'}`, 500);
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { token, email, new_password } = req.body;

  if (!token || !email || !new_password) {
    sendError(res, 'token, email, and new_password are required');
    return;
  }

  if (new_password.length < 8) {
    sendError(res, 'Password must be at least 8 characters');
    return;
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select('+resetPasswordToken +resetPasswordExpires');
  if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
    sendError(res, 'Invalid or expired reset link', 400);
    return;
  }

  if (user.resetPasswordToken !== token || user.resetPasswordExpires < new Date()) {
    sendError(res, 'Invalid or expired reset link', 400);
    return;
  }

  // Update password and clear reset fields
  user.password = new_password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  sendSuccess(res, null, 'Password reset successfully');
};
