import session from 'express-session';

/**
 * Database-agnostic Express session store using Prisma ORM.
 * Works identically on SQLite and PostgreSQL.
 */
export class PrismaSessionStore extends session.Store {
  private prisma: any;

  constructor(prisma: any) {
    super();
    this.prisma = prisma;
  }

  get(sid: string, callback: (err?: any, session?: session.SessionData | null) => void) {
    this.prisma.session
      .findUnique({ where: { sid } })
      .then((row: any) => {
        if (!row || new Date() > row.expire) {
          return callback(null, null);
        }
        callback(null, row.sess as session.SessionData);
      })
      .catch((err: any) => callback(err));
  }

  set(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const expire = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 86400000); // 24h default

    this.prisma.session
      .upsert({
        where: { sid },
        create: { sid, sess: sessionData as any, expire },
        update: { sess: sessionData as any, expire },
      })
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    this.prisma.session
      .delete({ where: { sid } })
      .then(() => callback?.())
      .catch((err: any) => {
        // Ignore "not found" errors — session may already be gone
        if (err?.code === 'P2025') return callback?.();
        callback?.(err);
      });
  }

  touch(sid: string, sessionData: session.SessionData, callback?: (err?: any) => void) {
    const expire = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 86400000);

    this.prisma.session
      .update({ where: { sid }, data: { expire } })
      .then(() => callback?.())
      .catch((err: any) => callback?.(err));
  }
}
