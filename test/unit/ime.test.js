const assert = require('assert');
const { parseImeState } = require('../../out/android/ime');

// Trimmed from a real `adb shell dumpsys input_method` on a Pixel_9 with Gboard open.
const SHOWN = `
  mCurMethodId=com.google.android.inputmethod.latin/.LatinIME
      mInputShown=true
  mIsInputViewShown=true mStatusIcon=0
    contentTopInsets=1399 visibleTopInsets=1399 touchableInsets=3 touchableRegion=SkRegion((0,1399,1080,2282))
`;

const HIDDEN = `
  mCurMethodId=com.google.android.inputmethod.latin/.LatinIME
      mInputShown=false
  mIsInputViewShown=false mStatusIcon=0
`;

describe('IME state parsing', () => {
  it('detects a visible keyboard and its touchable region', () => {
    const state = parseImeState(SHOWN);
    assert.strictEqual(state.showing, true);
    assert.deepStrictEqual(state.region, { left: 0, top: 1399, right: 1080, bottom: 2282 });
  });

  it('reports hidden when the input view is not shown', () => {
    const state = parseImeState(HIDDEN);
    assert.strictEqual(state.showing, false);
    assert.strictEqual(state.region, null);
  });

  it('ignores a stale region when the keyboard is hidden', () => {
    // A touchableRegion can linger in dumpsys after the IME is dismissed.
    const stale = HIDDEN + '\n    touchableRegion=SkRegion((0,1399,1080,2282))\n';
    const state = parseImeState(stale);
    assert.strictEqual(state.showing, false);
    assert.strictEqual(state.region, null);
  });

  it('picks the largest region when several are reported', () => {
    const multi =
      SHOWN + '\n    touchableRegion=SkRegion((0,0,10,10))\n';
    const state = parseImeState(multi);
    assert.deepStrictEqual(state.region, { left: 0, top: 1399, right: 1080, bottom: 2282 });
  });

  it('treats an empty region as no region', () => {
    const empty = '      mInputShown=true\n    touchableRegion=SkRegion()\n';
    assert.strictEqual(parseImeState(empty).region, null);
  });

  it('survives unexpected output', () => {
    assert.deepStrictEqual(parseImeState(''), { showing: false, region: null });
    assert.deepStrictEqual(parseImeState('garbage'), { showing: false, region: null });
  });
});
