import { Router } from 'express';
import crypto from 'crypto';

export const adminAuthRouter = Router();

adminAuthRouter.post('/admin/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({ error: 'Admin password not configured' });
  }

  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(adminPassword, 'utf8');
  const received = Buffer.from(password, 'utf8');

  const isValid =
    expected.length === received.length &&
    crypto.timingSafeEqual(expected, received);

  if (isValid) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }

  res.status(401).json({ error: 'Invalid password' });
});

adminAuthRouter.post('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

adminAuthRouter.get('/admin/check', (req, res) => {
  const isAdminSession = !!req.session.isAdmin;
  const role = (req.user as any)?.role;
  const isAdminRole = role === 'admin' || role === 'ADMIN';
  res.json({ authenticated: isAdminSession || isAdminRole });
});
