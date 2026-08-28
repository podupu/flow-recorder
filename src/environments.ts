/**
 * Named variable sets ("environments"), switched from the status bar and passed to Maestro as
 * `-e KEY=VALUE` flags at run time.
 *
 * `-e` is the officially supported way to vary values per run, so flows stay free of
 * hardcoded URLs and reference `${BASE_URL}` instead. Tag filters are carried alongside
 * because Maestro Studio's own Environments pair variables with include/exclude tags.
 *
 * Sources:
 *   https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants
 *   https://docs.maestro.dev/maestro-studio/environments-and-variables
 */

export const DEFAULT_ENVIRONMENTS_FILE = 'maestro-env.json';

export interface MaestroEnvironment {
  name: string;
  variables: Record<string, string>;
  includeTags?: string[];
  excludeTags?: string[];
}

export interface ParsedEnvironments {
  /** Each already merged with `$shared`, so callers never repeat that logic. */
  environments: MaestroEnvironment[];
  /** Values common to every environment; still applied when no environment is selected. */
  shared: Record<string, string>;
  /** Problems worth surfacing; parsing continues so one bad value cannot hide the rest. */
  errors: string[];
}

/** Follows REST Client's convention for variables common to all environments. */
export const SHARED_KEY = '$shared';

function coerceValue(name: string, key: string, raw: unknown, errors: string[]): string | undefined {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  // Stringifying an object would silently produce "[object Object]" as a variable value.
  errors.push(`${name}.${key}: expected a string, number or boolean`);
  return undefined;
}

function toStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v) => typeof v === 'string') as string[];
  return list.length ? list : undefined;
}

export function parseEnvironments(text: string): ParsedEnvironments {
  const errors: string[] = [];
  if (!text || !text.trim()) return { environments: [], shared: {}, errors };

  let data: any;
  try {
    data = JSON.parse(text);
  } catch (err: any) {
    return {
      environments: [],
      shared: {},
      errors: [`Could not parse ${DEFAULT_ENVIRONMENTS_FILE}: ${err.message}`]
    };
  }

  const raw = data && data.environments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { environments: [], shared: {}, errors };
  }

  const shared: Record<string, string> = {};
  if (raw[SHARED_KEY] && typeof raw[SHARED_KEY] === 'object') {
    for (const [key, value] of Object.entries<any>(raw[SHARED_KEY])) {
      const coerced = coerceValue(SHARED_KEY, key, value, errors);
      if (coerced !== undefined) shared[key] = coerced;
    }
  }

  const environments: MaestroEnvironment[] = [];
  for (const [name, body] of Object.entries<any>(raw)) {
    if (name === SHARED_KEY) continue;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      errors.push(`${name}: expected an object of variables`);
      continue;
    }

    // Long form declares `variables`; shorthand is the object itself.
    const isLongForm = body.variables && typeof body.variables === 'object';
    const source = isLongForm ? body.variables : body;

    const variables: Record<string, string> = {};
    for (const [key, value] of Object.entries<any>(source)) {
      if (!isLongForm && (key === 'includeTags' || key === 'excludeTags')) continue;
      const coerced = coerceValue(name, key, value, errors);
      if (coerced !== undefined) variables[key] = coerced;
    }

    environments.push({
      name,
      // Shared first so an environment's own value wins on conflict.
      variables: { ...shared, ...variables },
      includeTags: toStringList(body.includeTags),
      excludeTags: toStringList(body.excludeTags)
    });
  }

  return { environments, shared, errors };
}

/**
 * Builds the argv for `maestro`. Returned as an array, never a shell string, so a value
 * containing spaces or quotes cannot break the command or be re-interpreted by a shell.
 */
export interface RunOptions {
  /** Directory to keep screenshots, hierarchy dumps and logs in. */
  debugOutput?: string;
  /** Write artifacts without per-run timestamped subfolders. Requires debugOutput. */
  flattenDebugOutput?: boolean;
  /**
   * Device to run against. Without it `maestro test -p ios` picks its own simulator and boots
   * it - so a run can silently target a different device than the one being mirrored.
   */
  deviceId?: string;
}

export function buildMaestroArgs(
  environment: MaestroEnvironment | undefined,
  flowPath: string,
  platform?: string,
  options: RunOptions = {}
): string[] {
  const args: string[] = ['test'];

  // `maestro test -p <platform>`; the CLI takes the lowercase form, while the in-flow
  // `when: platform:` condition uses Android/iOS/Web.
  if (platform) args.push('-p', platform.toLowerCase());
  if (options.deviceId) args.push('--udid', options.deviceId);

  // Maestro exposes no debug protocol, so the debug profile means "keep the artifacts".
  if (options.debugOutput) {
    args.push('--debug-output', options.debugOutput);
    if (options.flattenDebugOutput) args.push('--flatten-debug-output');
  }

  if (environment) {
    for (const [key, value] of Object.entries(environment.variables)) {
      args.push('-e', `${key}=${value}`);
    }
    if (environment.includeTags?.length) args.push('--include-tags', environment.includeTags.join(','));
    if (environment.excludeTags?.length) args.push('--exclude-tags', environment.excludeTags.join(','));
  }

  args.push(flowPath);
  return args;
}

export function defaultEnvironmentsTemplate(): string {
  // Placeholder hosts use example.com (IANA-reserved for documentation) so they can never be
  // mistaken for real infrastructure. A plausible-looking invented hostname produces a
  // confusing DNS failure at run time instead of an obvious "fill this in".
  return (
    JSON.stringify(
      {
        $comment:
          'Named variable sets for Maestro, passed as -e KEY=VALUE; reference in flows as ${BASE_URL}. Replace the example.com hosts with your own. Do not put credentials in this file.',
        environments: {
          $shared: {
            SHOW_LOGS: 'true'
          },
          staging: {
            BASE_URL: 'https://staging.api.example.com',
            ENV: 'staging'
          },
          prod: {
            BASE_URL: 'https://api.example.com',
            ENV: 'prod'
          }
        }
      },
      null,
      2
    ) + '\n'
  );
}
