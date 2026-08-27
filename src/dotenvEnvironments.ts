/**
 * Environments as `.env.*` files at the workspace root.
 *
 *   .env                  shared base, merged under every environment
 *   .env.android          -> environment "android"
 *   .env.staging.android  -> environment "staging.android"
 *
 * Plain dotenv files rather than a database: they are diffable, editable without any tool,
 * already understood by every developer, and - critically - easy to gitignore. Maestro
 * Studio keeps the same data in a Flyway-migrated SQLite file it owns; writing into another
 * application's migrated database is not worth the corruption risk.
 *
 * Values become `maestro test -e KEY=VALUE` flags at run time.
 */

export const BASE_ENV_FILE = '.env';

/** Templates, not real environments. */
const TEMPLATE_SUFFIXES = ['example', 'sample', 'template', 'dist'];

/**
 * Parses dotenv text. Deliberately close to the dotenv convention: `KEY=VALUE`, `#` comments,
 * an optional `export` prefix, and quotes that protect surrounding whitespace and `#`.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue; // no key, or no '=' at all

    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;

    let value = withoutExport.slice(eq + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      // Quoted: whitespace and '#' inside are part of the value.
      value = value.slice(1, -1);
    } else {
      // Unquoted: an inline comment ends the value. A base64 '=' is safe here because only
      // the FIRST '=' split the line.
      const hash = value.indexOf('#');
      if (hash !== -1) value = value.slice(0, hash);
      value = value.trim();
    }

    out[key] = value;
  }

  return out;
}

export function isEnvFile(fileName: string): boolean {
  if (fileName === BASE_ENV_FILE) return true;
  if (!fileName.startsWith(`${BASE_ENV_FILE}.`)) return false;
  const suffix = fileName.slice(BASE_ENV_FILE.length + 1);
  if (!suffix) return false;
  return !TEMPLATE_SUFFIXES.includes(suffix.toLowerCase());
}

/** The environment name a file declares, or undefined for the shared base. */
export function environmentNameFromFile(fileName: string): string | undefined {
  if (!isEnvFile(fileName) || fileName === BASE_ENV_FILE) return undefined;
  return fileName.slice(BASE_ENV_FILE.length + 1) || undefined;
}

/**
 * Platform implied by the name, so `.env.android_V2` selects Android without a second click.
 * Matched on word-ish boundaries so "audios" is not read as iOS.
 */
export function platformFromName(name: string): 'Android' | 'iOS' | undefined {
  const lower = (name || '').toLowerCase();
  if (/(^|[^a-z])android/.test(lower)) return 'Android';
  if (/(^|[^a-z])ios($|[^a-z])/.test(lower)) return 'iOS';
  return undefined;
}

/** Environment values win over the shared base. */
export function mergeEnvironment(
  base: Record<string, string>,
  environment: Record<string, string>
): Record<string, string> {
  return { ...base, ...environment };
}
