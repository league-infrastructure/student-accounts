export interface SessionListItem {
  sid: string;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
  expires: Date;
  createdAt: Date | null;
}

export class SessionService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list(): Promise<SessionListItem[]> {
    const sessions = await this.prisma.session.findMany({
      where: { expire: { gt: new Date() } },
      orderBy: { expire: 'desc' },
    });

    const items: SessionListItem[] = [];

    for (const s of sessions) {
      const sess = s.sess as Record<string, unknown>;
      let userId: number | null = null;

      // Extract user ID from passport session data
      if (sess.passport && typeof sess.passport === 'object') {
        const passport = sess.passport as Record<string, unknown>;
        if (passport.user && typeof passport.user === 'object') {
          const user = passport.user as Record<string, unknown>;
          if (typeof user.id === 'number') {
            userId = user.id;
          }
        }
      }

      let userEmail: string | null = null;
      let userName: string | null = null;
      let userRole: string | null = null;

      if (userId) {
        try {
          const dbUser = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, displayName: true, role: true },
          });
          if (dbUser) {
            userEmail = dbUser.email;
            userName = dbUser.displayName;
            userRole = dbUser.role;
          }
        } catch {
          // User may have been deleted; leave fields null
        }
      }

      items.push({
        sid: s.sid,
        userEmail,
        userName,
        userRole,
        expires: s.expire,
        createdAt: null, // session table has no createdAt column
      });
    }

    return items;
  }

  async count(): Promise<number> {
    return this.prisma.session.count({
      where: { expire: { gt: new Date() } },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: { expire: { lt: new Date() } },
    });
    return result.count;
  }
}
