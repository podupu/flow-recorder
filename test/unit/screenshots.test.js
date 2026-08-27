const assert = require('assert');
const { sanitizeScreenshotName, uniqueScreenshotName, ASSETS_DIR } = require('../../out/screenshots');

describe('screenshot naming', () => {
  it('defaults to a usable name', () => {
    assert.strictEqual(sanitizeScreenshotName(''), 'screenshot');
    assert.strictEqual(sanitizeScreenshotName('   '), 'screenshot');
    assert.strictEqual(sanitizeScreenshotName(undefined), 'screenshot');
  });

  it('strips a .png the user already typed', () => {
    assert.strictEqual(sanitizeScreenshotName('login.png'), 'login');
    assert.strictEqual(sanitizeScreenshotName('login.PNG'), 'login');
  });

  it('replaces path separators and unsafe characters', () => {
    // A name goes straight into a file path, so it must not escape the assets dir.
    assert.strictEqual(sanitizeScreenshotName('../../etc/passwd'), 'etc-passwd');
    assert.strictEqual(sanitizeScreenshotName('my shot!'), 'my-shot');
    assert.strictEqual(sanitizeScreenshotName('a/b\\c'), 'a-b-c');
  });

  it('keeps letters, digits, dashes and underscores', () => {
    assert.strictEqual(sanitizeScreenshotName('Login_Screen-2'), 'Login_Screen-2');
  });

  it('collapses runs of separators and trims them', () => {
    assert.strictEqual(sanitizeScreenshotName('--a---b--'), 'a-b');
  });

  it('never returns an empty string', () => {
    assert.strictEqual(sanitizeScreenshotName('!!!'), 'screenshot');
  });
});

describe('screenshot uniqueness', () => {
  it('uses the plain name when it is free', () => {
    assert.strictEqual(uniqueScreenshotName('login', []), 'login.png');
  });

  it('suffixes when the name is taken', () => {
    assert.strictEqual(uniqueScreenshotName('login', ['login.png']), 'login-2.png');
    assert.strictEqual(uniqueScreenshotName('login', ['login.png', 'login-2.png']), 'login-3.png');
  });

  it('does not overwrite an existing capture', () => {
    // The old stub always wrote assets/placeholder.png, silently clobbering each capture.
    const existing = ['step.png', 'step-2.png', 'step-3.png'];
    const next = uniqueScreenshotName('step', existing);
    assert.ok(!existing.includes(next), 'must not collide with an existing file');
    assert.strictEqual(next, 'step-4.png');
  });

  it('is case-insensitive about collisions', () => {
    assert.strictEqual(uniqueScreenshotName('Login', ['login.png']), 'Login-2.png');
  });

  it('exposes the assets directory name used in recorded paths', () => {
    assert.strictEqual(ASSETS_DIR, 'assets');
  });
});
