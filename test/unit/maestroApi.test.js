const assert = require('assert');
const {
  MAESTRO_COMMANDS,
  isMaestroCommand,
  needsScriptFile,
  buildApiSteps,
  isLegacyApiStep,
  convertLegacyApiStep
} = require('../../out/maestroApi');

describe('Maestro command vocabulary', () => {
  it('knows the official commands', () => {
    // Spot-check against docs.maestro.dev/reference/commands-available
    for (const cmd of ['tapOn', 'evalScript', 'runScript', 'assertTrue', 'takeScreenshot', 'toggleDarkMode']) {
      assert.ok(isMaestroCommand(cmd), `${cmd} should be a valid command`);
    }
  });

  it('rejects the invented ones the scaffold used', () => {
    assert.strictEqual(isMaestroCommand('apiRequest'), false);
    assert.strictEqual(isMaestroCommand('response'), false);
    assert.strictEqual(isMaestroCommand('note'), false);
  });

  it('has the documented number of commands', () => {
    assert.strictEqual(MAESTRO_COMMANDS.length, 48);
  });
});

describe('choosing inline vs script file', () => {
  it('keeps a bare GET inline', () => {
    assert.strictEqual(needsScriptFile({ method: 'GET', url: 'https://x.test/api' }), false);
  });

  it('uses a script file when headers are present', () => {
    assert.strictEqual(
      needsScriptFile({ method: 'GET', url: 'https://x.test', headers: { Authorization: 'Bearer t' } }),
      true
    );
  });

  it('uses a script file when a body is present', () => {
    assert.strictEqual(needsScriptFile({ method: 'POST', url: 'https://x.test', body: '{"a":1}' }), true);
  });

  it('uses a script file for verbs without a shorthand', () => {
    // http.get/post/put/delete have shorthands; PATCH needs http.request.
    assert.strictEqual(needsScriptFile({ method: 'PATCH', url: 'https://x.test' }), true);
  });
});

describe('building API steps', () => {
  it('emits evalScript + assertTrue for a simple GET', () => {
    const out = buildApiSteps(
      { method: 'GET', url: 'https://staging.api.portal.myconneqt.com/api', expectStatus: 200 },
      { outputVar: 'api1' }
    );
    assert.strictEqual(out.script, undefined);
    assert.deepStrictEqual(out.steps, [
      { evalScript: "${output.api1 = http.get('https://staging.api.portal.myconneqt.com/api')}" },
      { assertTrue: '${output.api1.status == 200}' }
    ]);
  });

  it('only emits official command keys', () => {
    const out = buildApiSteps({ method: 'GET', url: 'https://x.test' }, { outputVar: 'api1' });
    for (const step of out.steps) {
      for (const key of Object.keys(step)) {
        assert.ok(isMaestroCommand(key), `${key} is not an official Maestro command`);
      }
    }
  });

  it('escapes quotes in the URL so the expression cannot break', () => {
    const out = buildApiSteps({ method: 'GET', url: "https://x.test/a'b" }, { outputVar: 'api1' });
    assert.ok(out.steps[0].evalScript.includes("a\\'b"), 'single quote must be escaped');
  });

  it('emits runScript plus a script file when headers are present', () => {
    const out = buildApiSteps(
      {
        method: 'POST',
        url: 'https://x.test/login',
        headers: { 'Content-Type': 'application/json' },
        body: '{"user":"demo"}',
        expectStatus: 201
      },
      { outputVar: 'api2', scriptName: 'api-2' }
    );
    assert.deepStrictEqual(out.steps, [
      { runScript: 'scripts/api-2.js' },
      { assertTrue: '${output.api2Status == 201}' }
    ]);
    assert.strictEqual(out.script.fileName, 'api-2.js');
    assert.ok(out.script.contents.includes("http.post('https://x.test/login'"));
    assert.ok(out.script.contents.includes('Content-Type'));
    assert.ok(out.script.contents.includes('output.api2Status = response.status'));
  });

  it('uses http.request for verbs without a shorthand', () => {
    const out = buildApiSteps(
      { method: 'PATCH', url: 'https://x.test/thing', body: '{"a":1}' },
      { outputVar: 'api3', scriptName: 'api-3' }
    );
    assert.ok(out.script.contents.includes('http.request('));
    assert.ok(out.script.contents.includes('"PATCH"'));
  });

  it('defaults the asserted status to 200', () => {
    const out = buildApiSteps({ method: 'GET', url: 'https://x.test' }, { outputVar: 'api1' });
    assert.strictEqual(out.steps[1].assertTrue, '${output.api1.status == 200}');
  });
});

describe('migrating legacy apiRequest blocks', () => {
  const legacy = {
    apiRequest: { method: 'GET', url: 'https://staging.api.portal.myconneqt.com/api' },
    response: { status: 200, durationMs: 779, body: '' }
  };

  it('recognises the invalid block', () => {
    assert.strictEqual(isLegacyApiStep(legacy), true);
    assert.strictEqual(isLegacyApiStep({ tapOn: 'Login' }), false);
    assert.strictEqual(isLegacyApiStep(null), false);
    assert.strictEqual(isLegacyApiStep('back'), false);
  });

  it('converts it to official steps, preserving the observed status', () => {
    const steps = convertLegacyApiStep(legacy, 1);
    assert.deepStrictEqual(steps, [
      { evalScript: "${output.api1 = http.get('https://staging.api.portal.myconneqt.com/api')}" },
      { assertTrue: '${output.api1.status == 200}' }
    ]);
  });

  it('drops durationMs, which is not assertable', () => {
    const steps = convertLegacyApiStep(legacy, 1);
    assert.ok(!JSON.stringify(steps).includes('durationMs'));
  });

  it('returns null for anything that is not a legacy block', () => {
    assert.strictEqual(convertLegacyApiStep({ tapOn: 'x' }, 0), null);
  });
});

describe('header line parsing', () => {
  const { parseHeaderLine } = require('../../out/maestroApi');

  it('parses a single header', () => {
    assert.deepStrictEqual(parseHeaderLine('Content-Type: application/json'), {
      'Content-Type': 'application/json'
    });
  });

  it('parses several headers', () => {
    assert.deepStrictEqual(parseHeaderLine('A: 1, B: 2'), { A: '1', B: '2' });
  });

  it('keeps colons inside a value', () => {
    // Splitting on every colon would mangle a URL or a Bearer token.
    assert.deepStrictEqual(parseHeaderLine('Referer: https://x.test/a'), {
      Referer: 'https://x.test/a'
    });
  });

  it('returns undefined for empty or malformed input', () => {
    assert.strictEqual(parseHeaderLine(''), undefined);
    assert.strictEqual(parseHeaderLine(undefined), undefined);
    assert.strictEqual(parseHeaderLine('   '), undefined);
    assert.strictEqual(parseHeaderLine('nonsense'), undefined);
  });
});
