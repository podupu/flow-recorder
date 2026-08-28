import { DeviceDriver } from './deviceDriver';
import { classifyStep, ReplayOutcome } from './replay';

/**
 * Resolves a selector against the live device and returns its centre, in the driver's own
 * coordinate space. Matches Android's selector precedence: text, then id.
 */
async function locate(
  driver: DeviceDriver,
  selector: { text?: string; id?: string } | undefined
): Promise<{ x: number; y: number } | undefined> {
  if (!selector) return undefined;
  const elements = await driver.elements();
  const found = elements.find(
    (e) =>
      (selector.text !== undefined && e.text === selector.text) ||
      (selector.id !== undefined && e.resourceId === selector.id)
  );
  if (!found) return undefined;

  const size = await driver.screenSize();
  return {
    x: Math.round((found.left + found.width / 2) * size.width),
    y: Math.round((found.top + found.height / 2) * size.height)
  };
}

const SWIPE_VECTOR: Record<string, [number, number, number, number]> = {
  UP: [0.5, 0.75, 0.5, 0.25],
  DOWN: [0.5, 0.25, 0.5, 0.75],
  LEFT: [0.75, 0.5, 0.25, 0.5],
  RIGHT: [0.25, 0.5, 0.75, 0.5]
};

/**
 * Runs `steps` against `driver` directly - no `maestro` process is spawned, so the app's
 * current screen is never touched by a relaunch. Stops at the first step that genuinely
 * fails (a tap or assertion with no matching element); unsupported steps are skipped and
 * counted rather than treated as failures, since they were never expected to run.
 */
export async function replaySteps(
  driver: DeviceDriver,
  steps: any[],
  onStep?: (index: number, outcome: 'ok' | 'skipped' | 'failed') => void
): Promise<ReplayOutcome> {
  let replayed = 0;
  let skipped = 0;

  for (let i = 0; i < steps.length; i += 1) {
    const step = classifyStep(steps[i]);

    if (step.kind === 'unsupported') {
      skipped += 1;
      onStep?.(i, 'skipped');
      continue;
    }

    try {
      const ok = await runOne(driver, step);
      if (ok === false) {
        onStep?.(i, 'failed');
        return { replayed, skipped, failedAt: i, failure: describeFailure(step) };
      }
      replayed += 1;
      onStep?.(i, 'ok');
    } catch (err: any) {
      onStep?.(i, 'failed');
      return { replayed, skipped, failedAt: i, failure: err.message };
    }
  }

  return { replayed, skipped };
}

function describeFailure(step: ReturnType<typeof classifyStep>): string {
  const target = step.selector?.text ?? step.selector?.id;
  return target ? `no element matched "${target}"` : `${step.kind} could not be performed`;
}

/** @returns false for a located-but-failed check (a missed assertion); throws for a device error. */
async function runOne(driver: DeviceDriver, step: ReturnType<typeof classifyStep>): Promise<boolean> {
  switch (step.kind) {
    case 'tap': {
      const point = await locate(driver, step.selector);
      if (!point) return false;
      await driver.tap(point.x, point.y);
      return true;
    }
    case 'longPress': {
      const point = await locate(driver, step.selector);
      if (!point) return false;
      await driver.longPress(point.x, point.y);
      return true;
    }
    case 'doubleTap': {
      const point = await locate(driver, step.selector);
      if (!point) return false;
      await driver.doubleTap(point.x, point.y);
      return true;
    }
    case 'assertVisible': {
      const point = await locate(driver, step.selector);
      return !!point;
    }
    case 'assertNotVisible': {
      const point = await locate(driver, step.selector);
      return !point;
    }
    case 'inputText':
      await driver.inputText(step.value || '');
      return true;
    case 'eraseText':
      await driver.eraseText(step.count ?? 50);
      return true;
    case 'pressKey':
      await driver.pressKey(step.value || '');
      return true;
    case 'back':
      await driver.back();
      return true;
    case 'hideKeyboard':
      await driver.hideKeyboard();
      return true;
    case 'scroll':
      await driver.scroll();
      return true;
    case 'swipe': {
      const size = await driver.screenSize();
      const vec = SWIPE_VECTOR[step.direction || 'UP'] || SWIPE_VECTOR.UP;
      await driver.swipe(vec[0] * size.width, vec[1] * size.height, vec[2] * size.width, vec[3] * size.height);
      return true;
    }
    default:
      return true;
  }
}
