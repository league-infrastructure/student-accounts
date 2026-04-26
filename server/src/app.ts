import path from 'path';
import express from 'express';
import session from 'express-session';
import { PrismaSessionStore } from './services/prisma-session-store';
import passport from 'passport';
import pinoHttp from 'pino-http';
import { createLogger } from './services/logger';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { passphraseSignupRouter } from './routes/auth/passphrase-signup';
import { loginRouter } from './routes/auth/login';
import { adminRouter } from './routes/admin';
import { accountRouter } from './routes/account';
import { staffDirectoryRouter } from './routes/staff/directory';
import { llmProxyRouter } from './routes/llm-proxy';
import { impersonateMiddleware } from './middleware/impersonate';
import { mcpTokenAuth } from './middleware/mcpAuth';
import { createMcpHandler } from './mcp/handler';
import { errorHandler } from './middleware/errorHandler';
import { attachServices } from './middleware/services';
import { ServiceRegistry } from './services/service.registry';
import { configurePassport } from './services/auth/passport.config';
import { prisma } from './services/prisma';

const app = express();

// Trust first proxy (Caddy in production, Vite in dev)
app.set('trust proxy', 1);

// Global JSON parser for /api routes. Skip /proxy entirely — the LLM
// proxy router installs its own parser with a generous limit so
// large conversation payloads from Claude Code don't hit the 100KB
// default ceiling.
app.use((req, res, next) => {
  if (req.path.startsWith('/proxy/')) return next();
  return express.json()(req, res, next);
});

// Pino logger: shared multistream (stdout + in-memory ring buffer for
// the admin Logs panel). See services/logger.ts for the factory.
app.use(pinoHttp({ logger: createLogger('http') }));

// Session middleware — Prisma-based store works on both SQLite and Postgres.
// Falls back to MemoryStore in test environment.
const sessionConfig: session.SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    httpOnly: true,
  },
};

if (process.env.NODE_ENV !== 'test') {
  sessionConfig.store = new PrismaSessionStore(prisma);
}

app.use(session(sessionConfig));

// Service registry — provides req.services to all route handlers
const registry = ServiceRegistry.create('API');
app.use(attachServices(registry));

// Passport authentication — serialize/deserialize and strategy registration.
// configurePassport is called after the registry so UserService and LoginService are available.
configurePassport(passport, registry.users, registry.logins, prisma);
app.use(passport.initialize());
app.use(passport.session());
app.use(impersonateMiddleware);

// Routes
app.use('/api', healthRouter);
// Public auth routes — mounted before requireAuth middleware
app.use('/api/auth', passphraseSignupRouter);
app.use('/api/auth', loginRouter);
app.use('/api', authRouter);
app.use('/api', adminRouter);
app.use('/api', accountRouter);
app.use('/api', staffDirectoryRouter);

// LLM proxy — mounted OUTSIDE /api so Anthropic-compatible clients
// (Claude Code, VS Code extension) can set ANTHROPIC_BASE_URL to
// <origin>/proxy and append /v1/messages themselves. See Sprint 013.
app.use('/proxy/v1', llmProxyRouter);

// MCP endpoint — token-based auth, separate from session auth
app.post('/api/mcp', mcpTokenAuth, createMcpHandler());

// ---------------------------------------------------------------------------
// Stub landing routes (content provided by Sprint 003)
// ---------------------------------------------------------------------------

// GET /account — student account page placeholder.
// Returns 200 with placeholder text. Sprint 003 replaces this with the real UI.
app.get('/account', (_req: express.Request, res: express.Response) => {
  res.status(200).send('Account page — coming in Sprint 003');
});

// GET /staff — staff directory placeholder.
// Returns 200 with placeholder text. Sprint 003 replaces this with the real UI.
app.get('/staff', (_req: express.Request, res: express.Response) => {
  res.status(200).send('Staff directory — coming in Sprint 003');
});

app.use(errorHandler);

// In production, serve the built React app from /app/public.
// All non-API routes fall through to index.html for SPA routing.
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));
  app.get('*', (_req: express.Request, res: express.Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

export { registry };
export default app;
