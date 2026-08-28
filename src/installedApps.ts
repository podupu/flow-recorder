/**
 * Apps installed on the connected device, so "Launch app" can offer real bundle ids instead of
 * relying on a flow that may not declare one.
 */

export interface InstalledApp {
  bundleId: string;
  name?: string;
  isSystem: boolean;
}

/** Harnesses that are installed alongside the app under test but are never the target. */
const AUTOMATION_PREFIXES = ['dev.mobile.maestro', 'io.appium.', 'com.apple.test'];

export function isAutomationApp(bundleId: string): boolean {
  if (!bundleId) return false;
  // `.xctrunner` is the suffix Xcode gives a UI-test runner bundle.
  if (bundleId.endsWith('.xctrunner')) return true;
  return AUTOMATION_PREFIXES.some((p) => bundleId.startsWith(p));
}

/**
 * Parses `xcrun simctl listapps`, which emits an old-style plist rather than JSON: each app is
 * a quoted bundle id followed by a brace block.
 */
export function parseSimctlApps(text: string | undefined): InstalledApp[] {
  if (!text || !text.includes('=')) return [];

  const apps: InstalledApp[] = [];
  const blockRe = /"([A-Za-z0-9_.\-]+)"\s*=\s*\{([\s\S]*?)\n\s*\};/g;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(text))) {
    const [, bundleId, body] = match;
    const nameMatch = body.match(/CFBundleDisplayName\s*=\s*"?([^";\n]+)"?;/);
    apps.push({
      bundleId,
      name: nameMatch ? nameMatch[1].trim() : undefined,
      isSystem: /ApplicationType\s*=\s*System/.test(body)
    });
  }

  // User apps first: the app under test is almost never an Apple system app.
  return apps.sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
    return (a.name || a.bundleId).localeCompare(b.name || b.bundleId, undefined, { numeric: true });
  });
}

/** Parses `adb shell pm list packages`, whose lines are `package:<id>`. */
export function parseAndroidPackages(text: string | undefined): InstalledApp[] {
  if (!text) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => ({ bundleId: line.slice('package:'.length).trim(), isSystem: false }))
    .filter((app) => app.bundleId)
    .sort((a, b) => a.bundleId.localeCompare(b.bundleId, undefined, { numeric: true }));
}
