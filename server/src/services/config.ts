import { prisma } from './prisma';

export interface ConfigKeyMeta {
  key: string;
  group: string;
  label: string;
  isSecret: boolean;
  requiresRestart: boolean;
}

export const CONFIG_KEYS: ConfigKeyMeta[] = [
  // GitHub OAuth
  { key: 'GITHUB_CLIENT_ID', group: 'GitHub OAuth', label: 'Client ID', isSecret: false, requiresRestart: true },
  { key: 'GITHUB_CLIENT_SECRET', group: 'GitHub OAuth', label: 'Client Secret', isSecret: true, requiresRestart: true },
  // Google OAuth
  { key: 'GOOGLE_CLIENT_ID', group: 'Google OAuth', label: 'Client ID', isSecret: false, requiresRestart: true },
  { key: 'GOOGLE_CLIENT_SECRET', group: 'Google OAuth', label: 'Client Secret', isSecret: true, requiresRestart: true },
  // Pike 13
  { key: 'PIKE13_CLIENT_ID', group: 'Pike 13', label: 'Client ID', isSecret: false, requiresRestart: true },
  { key: 'PIKE13_CLIENT_SECRET', group: 'Pike 13', label: 'Client Secret', isSecret: true, requiresRestart: true },
  { key: 'PIKE13_API_BASE', group: 'Pike 13', label: 'API Base URL', isSecret: false, requiresRestart: false },
  // GitHub API
  { key: 'GITHUB_TOKEN', group: 'GitHub API', label: 'Personal Access Token', isSecret: true, requiresRestart: false },
  { key: 'GITHUB_STORAGE_REPO', group: 'GitHub API', label: 'Storage Repo (owner/repo)', isSecret: false, requiresRestart: false },
  // AI Services
  { key: 'ANTHROPIC_API_KEY', group: 'AI Services', label: 'Claude API Key', isSecret: true, requiresRestart: false },
  { key: 'OPENAI_API_KEY', group: 'AI Services', label: 'OpenAI API Key', isSecret: true, requiresRestart: false },
];

const CONFIG_KEY_SET = new Set(CONFIG_KEYS.map((k) => k.key));

// In-memory cache
const cache = new Map<string, string>();

/** Load all Config rows into the in-memory cache. Call at startup. */
export async function initConfigCache(): Promise<void> {
  try {
    const rows = await prisma.config.findMany();
    for (const row of rows) {
      cache.set(row.key, row.value);
    }
  } catch {
    // Database may not be available (e.g., during tests without DB)
  }
}

/** Get a config value. Env var takes precedence over database. */
export function getConfig(key: string): string | undefined {
  return process.env[key] || cache.get(key) || undefined;
}

/** Mask a secret value, showing only the last 4 characters. */
function maskValue(value: string): string {
  if (value.length <= 4) return '••••';
  return '••••••••' + value.slice(-4);
}

export interface ConfigEntry {
  key: string;
  group: string;
  label: string;
  value: string | null;
  source: 'environment' | 'database' | 'not set';
  isSecret: boolean;
  requiresRestart: boolean;
}

/** Get all known config keys with masked values and source info. */
export function getAllConfig(): ConfigEntry[] {
  return CONFIG_KEYS.map((meta) => {
    const envValue = process.env[meta.key];
    const dbValue = cache.get(meta.key);

    let value: string | null = null;
    let source: ConfigEntry['source'] = 'not set';

    if (envValue) {
      value = meta.isSecret ? maskValue(envValue) : envValue;
      source = 'environment';
    } else if (dbValue) {
      value = meta.isSecret ? maskValue(dbValue) : dbValue;
      source = 'database';
    }

    return { ...meta, value, source };
  });
}

/** Save a config value to the database and refresh the cache. */
export async function setConfig(key: string, value: string): Promise<{ warning?: string; restart?: boolean }> {
  if (!CONFIG_KEY_SET.has(key)) {
    throw new Error(`Unknown config key: ${key}`);
  }

  await prisma.config.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });

  cache.set(key, value);

  const meta = CONFIG_KEYS.find((k) => k.key === key)!;
  const result: { warning?: string; restart?: boolean } = {};

  if (process.env[key]) {
    result.warning = 'Environment variable overrides this value';
  }
  if (meta.requiresRestart) {
    result.restart = true;
  }

  return result;
}

/** Export all database-stored config values as KEY=value lines. */
export function exportConfig(): string {
  const lines: string[] = [];
  for (const [key, value] of cache.entries()) {
    if (CONFIG_KEY_SET.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
