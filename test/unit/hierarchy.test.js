const assert = require('assert');
const {
  looksLikeHierarchyXml,
  parseAccessibilityServices,
  classifyDumpFailure,
  formatHierarchyError,
  HierarchyUnavailableError
} = require('../../out/android/hierarchy');

describe('hierarchy dump validation', () => {
  it('accepts a real uiautomator dump', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">' +
      '<node index="0" text="Login" bounds="[0,0][100,100]"/></hierarchy>';
    assert.strictEqual(looksLikeHierarchyXml(xml), true);
  });

  it('rejects the cat-error text that adb puts on stdout', () => {
    // The exact bug: `adb exec-out cat` writes this to STDOUT and exits 0,
    // so it reached parseUiNodes() and silently produced zero elements.
    const catError = 'cat: /sdcard/flow-recorder-dump.xml: No such file or directory\n';
    assert.strictEqual(looksLikeHierarchyXml(catError), false);
  });

  it('rejects empty and whitespace output', () => {
    assert.strictEqual(looksLikeHierarchyXml(''), false);
    assert.strictEqual(looksLikeHierarchyXml('   \n  '), false);
  });

  it('rejects a hierarchy element with no nodes in it', () => {
    assert.strictEqual(looksLikeHierarchyXml('<hierarchy rotation="0"></hierarchy>'), false);
  });
});

describe('accessibility service parsing', () => {
  it('parses a single enabled service', () => {
    const out = 'com.mahoraga.portal/com.mahoraga.portal.service.MahoragaAccessibilityService\n';
    assert.deepStrictEqual(parseAccessibilityServices(out), ['com.mahoraga.portal']);
  });

  it('parses several colon-separated services', () => {
    const out = 'com.a/com.a.Svc:com.b/com.b.Svc\n';
    assert.deepStrictEqual(parseAccessibilityServices(out), ['com.a', 'com.b']);
  });

  it('treats null/none as no services', () => {
    assert.deepStrictEqual(parseAccessibilityServices('null\n'), []);
    assert.deepStrictEqual(parseAccessibilityServices(''), []);
  });
});

describe('dump failure classification', () => {
  it('detects the UiAutomation conflict from a SIGKILL', () => {
    // uiautomator dump is SIGKILLed (137) when another client holds UiAutomation.
    assert.strictEqual(classifyDumpFailure('Killed', 137), 'uiautomation-conflict');
  });

  it('detects the conflict from the already-registered exception', () => {
    const out = 'java.lang.IllegalStateException: UiAutomationService ... already registered!';
    assert.strictEqual(classifyDumpFailure(out, 1), 'uiautomation-conflict');
  });

  it('detects a missing dump file', () => {
    assert.strictEqual(
      classifyDumpFailure('cat: /data/local/tmp/x.xml: No such file or directory', 0),
      'missing-file'
    );
  });

  it('returns null for a successful dump', () => {
    assert.strictEqual(classifyDumpFailure('UI hierchary dumped to: /data/local/tmp/x.xml', 0), null);
  });
});

describe('actionable error messages', () => {
  it('names the blocking accessibility service', () => {
    const msg = formatHierarchyError('uiautomation-conflict', ['com.mahoraga.portal']);
    assert.ok(msg.includes('com.mahoraga.portal'), 'should name the blocking package');
    assert.ok(/accessibility/i.test(msg), 'should explain it is an accessibility service');
  });

  it('still explains the conflict when the blocker cannot be identified', () => {
    const msg = formatHierarchyError('uiautomation-conflict', []);
    assert.ok(/UiAutomation/i.test(msg));
    assert.ok(msg.length > 0);
  });

  it('builds a typed error carrying the blockers', () => {
    const err = new HierarchyUnavailableError('uiautomation-conflict', ['com.mahoraga.portal']);
    assert.ok(err instanceof Error);
    assert.strictEqual(err.reason, 'uiautomation-conflict');
    assert.deepStrictEqual(err.blockingServices, ['com.mahoraga.portal']);
    assert.ok(err.message.includes('com.mahoraga.portal'));
  });
});
