/**
 * Validation and diagnosis for `uiautomator dump` output.
 *
 * Two adb behaviours make hierarchy failures invisible unless they are checked for explicitly:
 *
 * 1. `adb exec-out cat <missing>` writes "cat: ...: No such file or directory" to STDOUT and
 *    exits 0, so execFile does not report an error.
 * 2. `parseUiNodes` finds no `<node` matches in that text and returns [], which is
 *    indistinguishable from "this screen genuinely has no elements".
 *
 * Together they turned a hard failure into a silently empty overlay: no outline, no hover,
 * no diagnostics. Everything here is pure so it can be unit tested without a device.
 */

export type HierarchyFailureReason = 'uiautomation-conflict' | 'missing-file' | 'empty' | 'unknown';

/**
 * True only for output that is actually a populated uiautomator dump. A `<hierarchy>` element
 * with no `<node>` children is treated as invalid: uiautomator always emits at least the root
 * window node on a live screen, so an empty one means the dump did not really happen.
 */
export function looksLikeHierarchyXml(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (!text.includes('<hierarchy')) return false;
  return text.includes('<node');
}

/**
 * Parses `settings get secure enabled_accessibility_services`, which is either the literal
 * "null" or a colon-separated list of `package/ServiceClass` entries. Returns package names.
 */
export function parseAccessibilityServices(output: string): string[] {
  const trimmed = (output || '').trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'none') return [];
  return trimmed
    .split(':')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('/')[0])
    .filter(Boolean);
}

/**
 * Classifies why a dump failed, given the combined output and exit code.
 *
 * Only one UiAutomation client may be registered at a time. The legacy `uiautomator` shell
 * command connects without FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES, so any running
 * accessibility service takes the slot and the dump process is SIGKILLed (exit 137).
 */
export function classifyDumpFailure(output: string, exitCode: number): HierarchyFailureReason | null {
  const text = (output || '').trim();

  if (exitCode === 137 || /\bKilled\b/.test(text)) return 'uiautomation-conflict';
  if (/UiAutomation(Service)?\b.*already registered/i.test(text)) return 'uiautomation-conflict';
  if (/UiAutomation not connected/i.test(text)) return 'uiautomation-conflict';
  if (/No such file or directory/i.test(text)) return 'missing-file';
  if (!text) return 'empty';
  if (/dumped to/i.test(text)) return null;
  return null;
}

/**
 * Test-automation drivers that register their own UiAutomation. These routinely outlive the
 * session that started them, and a leaked one blocks `uiautomator dump` until it is stopped.
 */
const DRIVER_PREFIXES = ['dev.mobile.maestro', 'io.appium.uiautomator2.server'];

/** Extracts running automation-driver package names from `adb shell ps -A` output. */
export function parseAutomationDrivers(psOutput: string): string[] {
  const found: string[] = [];
  for (const line of (psOutput || '').split('\n')) {
    const name = line.trim().split(/\s+/).pop();
    if (!name) continue;
    if (DRIVER_PREFIXES.some((p) => name.startsWith(p)) && !found.includes(name)) {
      found.push(name);
    }
  }
  return found;
}

export function formatHierarchyError(
  reason: HierarchyFailureReason,
  blockingServices: string[] = [],
  drivers: string[] = []
): string {
  switch (reason) {
    case 'uiautomation-conflict': {
      const base =
        'Element detection is unavailable: another app holds the device UiAutomation connection, ' +
        'so `uiautomator dump` is being killed before it can run.';
      // A leaked driver is both the more common cause and the easier one to clear, so it is
      // named first when both are present.
      if (drivers.length) {
        const names = drivers.join(', ');
        const stop = drivers.map((d) => `adb shell am force-stop ${d}`).join(' && ');
        return (
          `${base} The automation driver ${names} is still running - force-stop it ` +
          `(\`${stop}\`) to enable hover and element outlines.`
        );
      }
      if (blockingServices.length) {
        const names = blockingServices.join(', ');
        return (
          `${base} The enabled accessibility service ${names} is the likely cause - ` +
          `disable it (Settings > Accessibility, or \`adb shell settings put secure ` +
          `enabled_accessibility_services ""\`) to enable hover and element outlines.`
        );
      }
      return `${base} Disable any running accessibility service or automation driver, then reopen the mirror.`;
    }
    case 'missing-file':
      return 'Element detection is unavailable: uiautomator did not write a hierarchy file.';
    case 'empty':
      return 'Element detection is unavailable: the device returned an empty hierarchy.';
    default:
      return 'Element detection is unavailable: the hierarchy dump could not be read.';
  }
}

export class HierarchyUnavailableError extends Error {
  public readonly reason: HierarchyFailureReason;
  public readonly blockingServices: string[];
  public readonly drivers: string[];

  constructor(reason: HierarchyFailureReason, blockingServices: string[] = [], drivers: string[] = []) {
    super(formatHierarchyError(reason, blockingServices, drivers));
    this.name = 'HierarchyUnavailableError';
    this.reason = reason;
    this.blockingServices = blockingServices;
    this.drivers = drivers;
  }
}
