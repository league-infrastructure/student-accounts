import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Load .env from project root when running locally (not in Docker).
// In Docker, env vars are set by compose/entrypoint.
//
// This module MUST be imported before any module that reads process.env
// at load time (e.g., auth.ts registers OAuth strategies based on env vars).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
