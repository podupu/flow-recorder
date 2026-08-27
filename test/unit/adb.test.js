const assert = require('assert');
const {
  escapeInputText,
  keyNameToKeycode,
  orientationToSettings
} = require('../../out/android/adb');

describe('adb pure helpers', () => {
  it('escapes spaces for adb input text', () => {
    assert.strictEqual(escapeInputText('hello world'), 'hello%sworld');
    assert.strictEqual(escapeInputText('noSpaces'), 'noSpaces');
  });

  it('maps Maestro key names to Android keycodes', () => {
    assert.strictEqual(keyNameToKeycode('Home'), 3);
    assert.strictEqual(keyNameToKeycode('back'), 4);
    assert.strictEqual(keyNameToKeycode('volume up'), 24);
    assert.throws(() => keyNameToKeycode('nonsense'));
  });

  it('maps orientation to user_rotation value', () => {
    assert.strictEqual(orientationToSettings('LANDSCAPE'), '1');
    assert.strictEqual(orientationToSettings('PORTRAIT'), '0');
    assert.throws(() => orientationToSettings('SIDEWAYS'));
  });
});
