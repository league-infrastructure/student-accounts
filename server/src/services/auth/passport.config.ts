/**
 * Passport strategy configuration.
 *
 * Reads OAuth credentials from process.env and returns configured strategy
 * instances. If required env vars for a strategy are absent the strategy is
 * not registered and a warning is logged — the app still starts cleanly.
 *
 * This module does NOT import any Express types so that it can be tested
 * independently of the request/response cycle.
 *
 * Usage (in app.ts or a test helper):
 *
 *   import { configurePassport } from './services/auth/passport.config.js';
 *   configurePassport(passport, userService);
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import type { UserService } from '../user.service.js';
import type { LoginService } from '../login.service.js';
import { signInHandler } from './sign-in.handler.js';
import type { User } from '../../generated/prisma/client.js';

// ---------------------------------------------------------------------------
// OAuth env var reads
// ---------------------------------------------------------------------------

/** Read and return the Google OAuth config, or null if any var is missing. */
function readGoogleConfig(): {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
} | null {
  const clientID = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL;

  if (!clientID || !clientSecret || !callbackURL) {
    return null;
  }
  return { clientID, clientSecret, callbackURL };
}

/** Read and return the GitHub OAuth config, or null if any var is missing. */
function readGitHubConfig(): {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
} | null {
  const clientID = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const callbackURL = process.env.GITHUB_CALLBACK_URL;

  if (!clientID || !clientSecret || !callbackURL) {
    return null;
  }
  return { clientID, clientSecret, callbackURL };
}

// ---------------------------------------------------------------------------
// Strategy registration
// ---------------------------------------------------------------------------

/**
 * Register Passport serialize/deserialize and OAuth strategies.
 *
 * Strategies are skipped (not registered) if their required env vars are
 * absent. A console.warn is emitted so operators can diagnose missing config
 * without a startup crash.
 *
 * @param passportInstance  - The passport instance to configure.
 * @param userService       - UserService used by deserializeUser and sign-in handler.
 * @param loginService      - LoginService used by sign-in handler.
 */
export function configurePassport(
  passportInstance: typeof passport,
  userService: UserService,
  loginService: LoginService,
): void {
  // --- Serialize/Deserialize ---
  // serializeUser stores only the user's numeric id in the session.
  // deserializeUser loads the full User record from the database on each
  // request that has an active session.
  passportInstance.serializeUser((user: Express.User, done) => {
    done(null, (user as User).id);
  });

  passportInstance.deserializeUser(async (id: number, done) => {
    try {
      const user = await userService.findById(id);
      done(null, user);
    } catch (err) {
      // NotFoundError or DB error — treat as unauthenticated
      done(err, false);
    }
  });

  // --- Google OAuth 2.0 ---
  const googleConfig = readGoogleConfig();
  if (googleConfig) {
    passportInstance.use(
      new GoogleStrategy(
        {
          clientID: googleConfig.clientID,
          clientSecret: googleConfig.clientSecret,
          callbackURL: googleConfig.callbackURL,
          scope: ['profile', 'email'],
        },
        // Verify callback — wired to sign-in handler (T002).
        (_accessToken, _refreshToken, profile, done) => {
          const emails = profile.emails ?? [];
          const providerEmail = emails.find((e) => e.value)?.value ?? null;
          const displayName =
            profile.displayName ||
            profile.name?.givenName ||
            providerEmail ||
            profile.id;

          signInHandler('google', {
            providerUserId: profile.id,
            providerEmail,
            displayName,
            providerUsername: null,
          }, userService, loginService)
            .then((user) => done(null, user))
            .catch((err) => done(err));
        },
      ),
    );
  } else {
    console.warn(
      '[passport.config] Google OAuth strategy NOT registered — ' +
        'GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_CALLBACK_URL is missing.',
    );
  }

  // --- GitHub OAuth 2.0 ---
  const githubConfig = readGitHubConfig();
  if (githubConfig) {
    passportInstance.use(
      new GitHubStrategy(
        {
          clientID: githubConfig.clientID,
          clientSecret: githubConfig.clientSecret,
          callbackURL: githubConfig.callbackURL,
          scope: ['read:user', 'user:email'],
        },
        // Verify callback — replaced by the sign-in handler in T003.
        // Stub: returns 501 until the sign-in handler is wired.
        (_accessToken, _refreshToken, _profile, done) => {
          done(new Error('GitHub OAuth sign-in handler not yet implemented (T003)'));
        },
      ),
    );
  } else {
    console.warn(
      '[passport.config] GitHub OAuth strategy NOT registered — ' +
        'GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, or GITHUB_CALLBACK_URL is missing.',
    );
  }
}
