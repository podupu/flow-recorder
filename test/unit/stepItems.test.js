const assert = require('assert');
const {
  parseFlowSteps,
  isSetupStep,
  setupPrefixLength,
  buildPartialFlow,
  attributeFailure,
  stepLabel
} = require('../../out/stepItems');

const FLOW = [
  'appId: com.example.app',
  'env:',
  '  USER: demo',
  '---',
  '- launchApp',
  '- tapOn:',
  '    text: "Email Address"',
  '- inputText: demo@example.com',
  '- tapOn:',
  '    text: "Sign In"',
  '- assertVisible:',
  '    text: "Welcome"'
].join('\n');

describe('parsing steps with their line numbers', () => {
  it('finds every top-level step and the line it starts on', () => {
    const steps = parseFlowSteps(FLOW);
    assert.deepStrictEqual(steps.map((s) => s.line), [4, 5, 7, 8, 10]);
  });

  it('numbers steps from zero, matching the parsed array', () => {
    assert.deepStrictEqual(parseFlowSteps(FLOW).map((s) => s.index), [0, 1, 2, 3, 4]);
  });

  it('does not treat nested list items as steps', () => {
    const nested = ['appId: x', '---', '- repeat:', '    commands:', '      - tapOn: A'].join('\n');
    assert.strictEqual(parseFlowSteps(nested).length, 1);
  });

  it('returns nothing for a flow with no steps', () => {
    assert.deepStrictEqual(parseFlowSteps('appId: x\n---\n'), []);
    assert.deepStrictEqual(parseFlowSteps(''), []);
  });
});

describe('step labels for the Testing view', () => {
  it('names a step by its command and target', () => {
    const steps = parseFlowSteps(FLOW);
    assert.strictEqual(stepLabel(steps[0]), 'launchApp');
    assert.strictEqual(stepLabel(steps[1]), 'tapOn: Email Address');
    assert.strictEqual(stepLabel(steps[4]), 'assertVisible: Welcome');
  });

  it('falls back to the command alone when there is no obvious target', () => {
    const [s] = parseFlowSteps('appId: x\n---\n- back');
    assert.strictEqual(stepLabel(s), 'back');
  });
});

describe('identifying setup steps', () => {
  it('treats app lifecycle commands as setup', () => {
    assert.strictEqual(isSetupStep({ launchApp: { appId: 'x' } }), true);
    assert.strictEqual(isSetupStep('launchApp'), true);
    assert.strictEqual(isSetupStep({ clearState: null }), true);
    assert.strictEqual(isSetupStep({ setPermissions: {} }), true);
  });

  it('does not treat interaction as setup', () => {
    assert.strictEqual(isSetupStep({ tapOn: { text: 'A' } }), false);
    assert.strictEqual(isSetupStep({ assertVisible: { text: 'A' } }), false);
  });

  it('counts only the leading run of setup steps', () => {
    const steps = [{ launchApp: {} }, { clearState: null }, { tapOn: 'A' }, { launchApp: {} }];
    // The launchApp at the end is not part of the prefix.
    assert.strictEqual(setupPrefixLength(steps), 2);
  });

  it('is zero when the flow starts with an interaction', () => {
    assert.strictEqual(setupPrefixLength([{ tapOn: 'A' }, { launchApp: {} }]), 0);
  });
});

describe('building a partial flow to run from a line', () => {
  const header = { appId: 'com.example.app', env: { USER: 'demo' } };
  const steps = [{ launchApp: {} }, { tapOn: 'A' }, { tapOn: 'B' }, { assertVisible: 'C' }];

  it('keeps the header so the flow is runnable', () => {
    const out = buildPartialFlow(header, steps, 2);
    assert.ok(out.includes('appId: com.example.app'));
    assert.ok(out.includes('USER: demo'), 'env must survive');
    assert.ok(out.includes('---'), 'needs the document separator');
  });

  it('includes the setup prefix plus the chosen step onward', () => {
    const out = buildPartialFlow(header, steps, 2);
    // launchApp (setup) + steps 2 and 3, but not step 1.
    assert.ok(out.includes('launchApp'), 'setup prefix kept');
    assert.ok(out.includes('B'), 'chosen step included');
    assert.ok(out.includes('C'), 'later steps included');
    assert.ok(!/tapOn: A/.test(out), 'skipped step must not appear');
  });

  it('does not duplicate a setup step that is also the chosen one', () => {
    const out = buildPartialFlow(header, steps, 0);
    assert.strictEqual((out.match(/launchApp/g) || []).length, 1);
  });

  it('running from the last step includes setup and that step only', () => {
    const out = buildPartialFlow(header, steps, 3);
    assert.ok(out.includes('launchApp'));
    assert.ok(out.includes('C'));
    assert.ok(!/tapOn: B/.test(out));
  });
});

describe('attributing a failure to a step', () => {
  const steps = parseFlowSteps(FLOW);

  it('matches the failing step by the text in the message', () => {
    // Real message shape: Assertion is false: "Welcome" is visible
    const i = attributeFailure('Assertion is false: "Welcome" is visible', steps);
    assert.strictEqual(i, 4);
  });

  it('matches a tap target', () => {
    assert.strictEqual(attributeFailure('Element not found: "Sign In"', steps), 3);
  });

  it('returns undefined when the message names nothing recognisable', () => {
    assert.strictEqual(attributeFailure('Driver failed to start', steps), undefined);
  });

  it('handles an empty message', () => {
    assert.strictEqual(attributeFailure('', steps), undefined);
    assert.strictEqual(attributeFailure(undefined, steps), undefined);
  });

  describe('reading the failure reason from maestro output', () => {
    const { parseFailureSummary } = require('../../out/stepItems');
    const ESC = String.fromCharCode(27);

    // Captured verbatim from a real `maestro test --format JUNIT` run.
    const REAL = [
      'Waiting for flows to complete...',
      '[Failed] probe (18s) (Assertion is false: "ThisTextDefinitelyDoesNotExist" is visible)',
      '1/1 Flow Failed'
    ].join('\n');

    it('extracts the reason from real output', () => {
      assert.strictEqual(
        parseFailureSummary(REAL),
        'Assertion is false: "ThisTextDefinitelyDoesNotExist" is visible'
      );
    });

    it('survives the ANSI colouring maestro emits', () => {
      const coloured = `${ESC}[33mnoise${ESC}[0m\n[Failed] probe (2s) (Element not found: "Sign In")`;
      assert.strictEqual(parseFailureSummary(coloured), 'Element not found: "Sign In"');
    });

    it('returns undefined for a passing run', () => {
      assert.strictEqual(parseFailureSummary('1/1 Flow Passed'), undefined);
      assert.strictEqual(parseFailureSummary(''), undefined);
      assert.strictEqual(parseFailureSummary(undefined), undefined);
    });

    it('feeds straight into attributeFailure', () => {
      // End to end: real output -> reason -> the step that failed.
      const reason = parseFailureSummary(
        '[Failed] f (3s) (Assertion is false: "Welcome" is visible)'
      );
      assert.strictEqual(attributeFailure(reason, steps), 4);
    });
  });

  it('prefers the first step whose target appears, not a later coincidence', () => {
    const dup = parseFlowSteps(
      ['appId: x', '---', '- tapOn: "Next"', '- assertVisible: "Next"'].join('\n')
    );
    assert.strictEqual(attributeFailure('Element not found: "Next"', dup), 0);
  });
});
