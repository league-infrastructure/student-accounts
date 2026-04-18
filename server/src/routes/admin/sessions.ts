import { Router } from 'express';

export const adminSessionsRouter = Router();

adminSessionsRouter.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await req.services.sessions.list();

    const result = sessions.map((s) => ({
      sid: s.sid.slice(0, 8),
      userEmail: s.userEmail,
      userName: s.userName,
      userRole: s.userRole,
      expire: s.expires,
      hasUser: !!(s.userEmail),
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});
