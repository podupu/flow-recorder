import * as yaml from 'js-yaml';

/**
 * Per-step support for the Testing view: one test item per step, so VS Code draws a hover play
 * button and a pass/fail icon in the gutter beside each line.
 *
 * Two constraints shape this, both found by running Maestro and reading what it actually
 * emits rather than assuming:
 *
 *  - **Maestro reports per flow, not per step.** Its JUnit report contains one `<testcase>`
 *    for the whole flow, and its piped console output is a one-line summary. The pretty
 *    per-step ✅/❌ view is TTY-only. So step states are *reconstructed* from the failure
 *    message: everything before the failing step passed, everything after never ran.
 *  - **There is no "run from step N".** Running a single step means writing a temporary flow
 *    containing the setup prefix plus that step onward, and running that file.
 */

export interface FlowStep {
  /** Position in the parsed step array. */
  index: number;
  /** Zero-based line the step starts on, for the gutter decoration. */
  line: number;
  /** The parsed step value. */
  value: any;
}

/** Commands that put the app into a known state and are worth keeping on a mid-flow run. */
const SETUP_COMMANDS = ['launchApp', 'clearState', 'clearKeychain', 'setPermissions', 'stopApp', 'killApp'];

function commandOf(step: any): string | undefined {
  if (typeof step === 'string') return step;
  if (step && typeof step === 'object' && !Array.isArray(step)) return Object.keys(step)[0];
  return undefined;
}

/** The human-meaningful target of a step: the text or id it acts on. */
function targetOf(step: any): string | undefined {
  const command = commandOf(step);
  if (!command || typeof step === 'string') return undefined;
  const value = step[command];
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.id === 'string') return value.id;
  }
  return undefined;
}

export function stepLabel(step: FlowStep): string {
  const command = commandOf(step.value) ?? 'step';
  const target = targetOf(step.value);
  return target ? `${command}: ${target}` : command;
}

/**
 * Pairs each parsed step with the line it starts on. Steps are parsed with js-yaml (so nested
 * structures are correct) while lines come from a scan for top-level `- ` markers - the two
 * are in the same order, which is what lets a gutter icon land on the right line.
 */
export function parseFlowSteps(text: string): FlowStep[] {
  if (!text || !text.trim()) return [];

  let parsed: any;
  try {
    const docs = yaml.loadAll(text) as any[];
    parsed = docs.length >= 2 ? docs[1] : docs[0];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const lines: number[] = [];
  text.split('\n').forEach((line, i) => {
    if (/^-\s/.test(line) || /^-$/.test(line.trimEnd())) lines.push(i);
  });

  return parsed.map((value, index) => ({ index, line: lines[index] ?? 0, value }));
}

export function isSetupStep(step: any): boolean {
  const command = commandOf(step);
  return !!command && SETUP_COMMANDS.includes(command);
}

/** Length of the leading run of setup steps - only the prefix, not setup found later. */
export function setupPrefixLength(steps: any[]): number {
  let n = 0;
  for (const step of steps) {
    if (!isSetupStep(step)) break;
    n += 1;
  }
  return n;
}

/**
 * A runnable flow containing the setup prefix plus `fromIndex` onward.
 *
 * The prefix is kept because most flows assume the app is already open - running from the
 * middle without it usually fails on the first interaction, which looks like a broken feature
 * rather than a missing precondition.
 */
export function buildPartialFlow(header: Record<string, any>, steps: any[], fromIndex: number): string {
  const prefix = setupPrefixLength(steps);
  const setup = fromIndex < prefix ? [] : steps.slice(0, prefix);
  const chosen = steps.slice(fromIndex);

  const headerYaml = yaml.dump(header || {}, { lineWidth: -1 });
  const stepsYaml = yaml.dump([...setup, ...chosen], { lineWidth: -1 });
  return `${headerYaml}---\n${stepsYaml}`;
}

/**
 * Which step a failure message refers to.
 *
 * Maestro's messages quote the target, e.g. `Assertion is false: "Welcome" is visible`, so the
 * step is found by looking for one whose target appears in the message. Returns undefined for
 * failures that name no step at all (a driver that would not start, say) rather than blaming
 * an arbitrary one.
 */
export function attributeFailure(message: string | undefined, steps: FlowStep[]): number | undefined {
  if (!message) return undefined;

  for (const step of steps) {
    const target = targetOf(step.value);
    if (!target) continue;
    if (message.includes(`"${target}"`) || message.includes(`'${target}'`)) return step.index;
  }
  return undefined;
}

/**
 * The reason from Maestro's summary line, e.g.
 * `[Failed] probe (18s) (Assertion is false: "Welcome" is visible)`.
 *
 * ANSI escapes are stripped first: Maestro colourises its output and prints a banner, and
 * those sequences would otherwise confuse the bracket matching.
 */
export function parseFailureSummary(output: string | undefined): string | undefined {
  if (!output) return undefined;
  // Must be anchored to the escape character: a bare /\[[0-9;]*[A-Za-z]/ also matches the
  // "[F" of "[Failed]" and destroys the very marker being looked for.
  const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const match = clean.match(/\[Failed\][^\n(]*\([^)\n]*\)\s*\(([^\n]+)\)\s*$/m);
  return match ? match[1].trim() : undefined;
}
