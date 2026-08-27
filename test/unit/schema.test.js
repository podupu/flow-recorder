const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { buildApiSteps, convertLegacyApiStep } = require('../../out/maestroApi');

// The official Maestro Flow schema, bundled from schemastore.org/maestro-flow.json.
const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../schemas/maestro-flow.json'), 'utf8')
);

// The schema describes the steps document (the part after `---`).
const ajv = new Ajv({ strict: false, allErrors: true });
const validate = ajv.compile(schema);

function check(steps) {
  const ok = validate(steps);
  return { ok, errors: ok ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`) };
}

describe('generated steps validate against the official Maestro schema', () => {
  it('accepts a simple GET translated to evalScript + assertTrue', () => {
    const { steps } = buildApiSteps(
      { method: 'GET', url: 'https://staging.api.portal.myconneqt.com/api', expectStatus: 200 },
      { outputVar: 'api1' }
    );
    const r = check(steps);
    assert.ok(r.ok, `should be valid, got: ${r.errors.join('; ')}`);
  });

  it('accepts a POST translated to runScript + assertTrue', () => {
    const { steps } = buildApiSteps(
      {
        method: 'POST',
        url: 'https://x.test/login',
        headers: { 'Content-Type': 'application/json' },
        body: '{"a":1}',
        expectStatus: 201
      },
      { outputVar: 'api2', scriptName: 'api-2' }
    );
    const r = check(steps);
    assert.ok(r.ok, `should be valid, got: ${r.errors.join('; ')}`);
  });

  it('accepts the steps the mirror records', () => {
    const steps = [
      { launchApp: { appId: 'com.example.app' } },
      { tapOn: { text: 'Login' } },
      { tapOn: { id: 'com.example:id/button' } },
      { longPressOn: { text: 'Item' } },
      { doubleTapOn: { text: 'Item' } },
      { inputText: 'hello' },
      { eraseText: 50 },
      { pressKey: 'home' },
      'back',
      'hideKeyboard',
      { swipe: { direction: 'UP' } },
      { takeScreenshot: 'assets/step.png' },
      { assertVisible: { text: 'Welcome' } },
      { assertNotVisible: { text: 'Error' } },
      { setOrientation: 'LANDSCAPE' },
      { setClipboard: 'text' },
      'pasteText',
      'toggleDarkMode',
      'scroll'
    ];
    const r = check(steps);
    assert.ok(r.ok, `mirror steps should be valid, got: ${r.errors.join('; ')}`);
  });

  it('rejects the legacy apiRequest block the scaffold produced', () => {
    const legacy = [
      {
        apiRequest: { method: 'GET', url: 'https://x.test' },
        response: { status: 200, durationMs: 779, body: '' }
      }
    ];
    assert.strictEqual(check(legacy).ok, false, 'apiRequest must NOT validate');
  });

  it('accepts the migrated form of that same block', () => {
    const steps = convertLegacyApiStep(
      { apiRequest: { method: 'GET', url: 'https://x.test' }, response: { status: 200 } },
      1
    );
    const r = check(steps);
    assert.ok(r.ok, `migrated steps should be valid, got: ${r.errors.join('; ')}`);
  });
});
