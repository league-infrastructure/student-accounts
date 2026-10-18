import { prisma } from './prisma';

export interface ConfigKeyMeta {
  key: string;
  group: string;
  label: string;
  isSecret: boolean;
  requiresRestart: boolean;
  /** Value getConfig returns when neither env nor database sets the key. */
  defaultValue?: string;
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
  { key: 'ANTHROPIC_API_KEY', group: 'AI Services', label: 'Claude Admin API Key', isSecret: true, requiresRestart: false },
  { key: 'OPENAI_API_KEY', group: 'AI Services', label: 'OpenAI API Key', isSecret: true, requiresRestart: false },
  // LLM Proxy (OpenRouter)
  { key: 'OPENROUTER_API_KEY', group: 'LLM Proxy', label: 'OpenRouter API Key', isSecret: true, requiresRestart: false },
  { key: 'LLM_PROXY_BASE_URL', group: 'LLM Proxy', label: 'Base URL', isSecret: false, requiresRestart: false },
  { key: 'LLM_PROXY_MODEL_LARGE', group: 'LLM Proxy', label: 'Large Model', isSecret: false, requiresRestart: false },
  { key: 'LLM_PROXY_MODEL_MEDIUM', group: 'LLM Proxy', label: 'Medium Model', isSecret: false, requiresRestart: false },
  { key: 'LLM_PROXY_MODEL_SMALL', group: 'LLM Proxy', label: 'Small Model', isSecret: false, requiresRestart: false },
  // 'true' once the Anthropic-compatible endpoint ships (sprint 003); the fleet
  // token endpoint then advertises anthropic_base_url to the laptops.
  { key: 'LLM_PROXY_ANTHROPIC_ENABLED', group: 'LLM Proxy', label: 'Anthropic Endpoint Enabled', isSecret: false, requiresRestart: false, defaultValue: 'false' },
  // Laptop accounts (DigitalOcean Spaces roster bucket; the same key also uploads backups)
  { key: 'DO_SPACES_ENDPOINT', group: 'Laptop accounts', label: 'Spaces Endpoint', isSecret: false, requiresRestart: true },
  { key: 'DO_SPACES_KEY', group: 'Laptop accounts', label: 'Spaces Access Key', isSecret: true, requiresRestart: true },
  { key: 'DO_SPACES_SECRET', group: 'Laptop accounts', label: 'Spaces Secret Key', isSecret: true, requiresRestart: true },
  { key: 'DO_SPACES_REGION', group: 'Laptop accounts', label: 'Spaces Region', isSecret: false, requiresRestart: true, defaultValue: 'sfo3' },
  { key: 'LAPTOP_ROSTER_BUCKET', group: 'Laptop accounts', label: 'Roster Bucket', isSecret: false, requiresRestart: false, defaultValue: 'jtl-student-unix-accounts' },
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

/** Get a config value. Env var takes precedence over database, then the key's defaultValue. */
export function getConfig(key: string): string | undefined {
  return process.env[key] || cache.get(key) || CONFIG_KEYS.find((k) => k.key === key)?.defaultValue || undefined;
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
