/**
 * passphraseSignupRouter — public POST /api/auth/passphrase-signup endpoint.
 *
 * No auth required. Students self-register using a time-limited passphrase
 * tied to a Group or Cohort scope.
 */

import { Router } from 'express';
import { handlePassphraseSignup } from '../../services/auth/passphrase-signup.handler.js';

export const passphraseSignupRouter = Router();
passphraseSignupRouter.post('/passphrase-signup', handlePassphraseSignup);
