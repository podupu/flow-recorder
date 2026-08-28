const assert = require('assert');
const { TELEMETRY_EVENTS, isEventAllowed, sanitiseProperties, shouldSend } = require('../../out/telemetry');

describe('telemetry event allowlist', () => {
  it('defines exactly the three events the MVP needs', () => {
    // The denominator for any conversion estimate: adoption, usage, and value.
    assert.deepStrictEqual(TELEMETRY_EVENTS, ['mirrorOpened', 'stepRecorded', 'flowRun']);
  });

  it('rejects anything not on the allowlist', () => {
    assert.strictEqual(isEventAllowed('mirrorOpened'), true);
    assert.strictEqual(isEventAllowed('selectorText'), false);
    assert.strictEqual(isEventAllowed(''), false);
  });
});

describe('property sanitising', () => {
  it('keeps only the small set of safe keys', () => {
    const out = sanitiseProperties({ platform: 'iOS', stepType: 'tapOn', outcome: 'passed' });
    assert.deepStrictEqual(out, { platform: 'iOS', stepType: 'tapOn', outcome: 'passed' });
  });

  it('drops anything identifying, even if a caller passes it', () => {
    // A selector or path would leak app internals and file layout.
    const out = sanitiseProperties({
      platform: 'Android',
      selector: 'com.myapp:id/secret_button',
      flowPath: '/Users/someone/work/app/login.flow.yaml',
      deviceId: 'emulator-5554',
      text: 'user@example.com'
    });
    assert.deepStrictEqual(out, { platform: 'Android' });
  });

  it('rejects unexpected values for an allowed key', () => {
    // Guards against a bug widening the payload through a known key.
    assert.deepStrictEqual(sanitiseProperties({ platform: 'com.myapp:id/leak' }), {});
    assert.deepStrictEqual(sanitiseProperties({ outcome: 'a'.repeat(200) }), {});
  });

  it('handles empty and malformed input', () => {
    assert.deepStrictEqual(sanitiseProperties(undefined), {});
    assert.deepStrictEqual(sanitiseProperties(null), {});
    assert.deepStrictEqual(sanitiseProperties('nope'), {});
  });
});

describe('send gating', () => {
  it('requires both the extension setting and VS Code telemetry', () => {
    // Opt-in twice over: ours defaults off, and VS Code's global switch still wins.
    assert.strictEqual(shouldSend({ settingEnabled: true, vscodeEnabled: true }), true);
    assert.strictEqual(shouldSend({ settingEnabled: true, vscodeEnabled: false }), false);
    assert.strictEqual(shouldSend({ settingEnabled: false, vscodeEnabled: true }), false);
    assert.strictEqual(shouldSend({ settingEnabled: false, vscodeEnabled: false }), false);
  });

  it('defaults to not sending when state is unknown', () => {
    assert.strictEqual(shouldSend({}), false);
    assert.strictEqual(shouldSend(undefined), false);
  });
});
