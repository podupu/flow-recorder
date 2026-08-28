const assert = require('assert');
const { classifyStep, summariseReplay } = require('../../out/replay');

describe('classifying steps for replay', () => {
  const kindOf = (step) => classifyStep(step).kind;

  it('handles the tap family', () => {
    assert.strictEqual(kindOf({ tapOn: { text: 'Login' } }), 'tap');
    assert.strictEqual(kindOf({ longPressOn: { text: 'Item' } }), 'longPress');
    assert.strictEqual(kindOf({ doubleTapOn: { id: 'x' } }), 'doubleTap');
  });

  it('carries the selector through', () => {
    assert.deepStrictEqual(classifyStep({ tapOn: { text: 'Login' } }).selector, { text: 'Login' });
    // Shorthand string form means match on text.
    assert.deepStrictEqual(classifyStep({ tapOn: 'Login' }).selector, { text: 'Login' });
  });

  it('handles input, keys and navigation', () => {
    assert.strictEqual(kindOf({ inputText: 'hello' }), 'inputText');
    assert.strictEqual(kindOf({ pressKey: 'enter' }), 'pressKey');
    assert.strictEqual(kindOf('back'), 'back');
    assert.strictEqual(kindOf('hideKeyboard'), 'hideKeyboard');
    assert.strictEqual(kindOf('scroll'), 'scroll');
    assert.strictEqual(kindOf({ eraseText: 20 }), 'eraseText');
  });

  it('handles swipe with a direction', () => {
    const c = classifyStep({ swipe: { direction: 'UP' } });
    assert.strictEqual(c.kind, 'swipe');
    assert.strictEqual(c.direction, 'UP');
  });

  it('handles assertions', () => {
    assert.strictEqual(kindOf({ assertVisible: { text: 'Welcome' } }), 'assertVisible');
    assert.strictEqual(kindOf({ assertNotVisible: { text: 'Error' } }), 'assertNotVisible');
  });

  it('marks steps needing the Maestro engine as unsupported, with a reason', () => {
    for (const step of [
      { runFlow: 'a.flow.yaml' },
      { runScript: 'a.js' },
      { evalScript: '${output.x = 1}' },
      { assertTrue: '${output.x == 1}' }
    ]) {
      const c = classifyStep(step);
      assert.strictEqual(c.kind, 'unsupported', `${JSON.stringify(step)} should be unsupported`);
      assert.ok(/maestro/i.test(c.reason), `reason should name Maestro: ${c.reason}`);
    }
  });

  it('marks any step containing a variable as unsupported', () => {
    // Maestro substitutes ${...} at run time; replay has no such engine.
    const c = classifyStep({ tapOn: { text: '${USERNAME}' } });
    assert.strictEqual(c.kind, 'unsupported');
    assert.ok(/variable/i.test(c.reason), c.reason);
  });

  it('marks an unknown command unsupported rather than guessing', () => {
    const c = classifyStep({ someFutureCommand: 'x' });
    assert.strictEqual(c.kind, 'unsupported');
  });

  it('survives malformed steps', () => {
    assert.strictEqual(kindOf(null), 'unsupported');
    assert.strictEqual(kindOf(42), 'unsupported');
    assert.strictEqual(kindOf({}), 'unsupported');
  });
});

describe('summarising a replay', () => {
  it('reports what ran and what did not', () => {
    const s = summariseReplay({ replayed: 3, skipped: 1, failedAt: undefined });
    assert.ok(s.includes('3'), s);
    assert.ok(/skipped/i.test(s), s);
  });

  it('says so plainly when nothing was skipped', () => {
    const s = summariseReplay({ replayed: 4, skipped: 0, failedAt: undefined });
    assert.ok(!/skipped/i.test(s), `should not mention skipping: ${s}`);
    assert.ok(s.includes('4'), s);
  });

  it('names the step that stopped the replay', () => {
    const s = summariseReplay({ replayed: 2, skipped: 0, failedAt: 5, failure: 'Element not found' });
    assert.ok(s.includes('6'), `should be 1-based: ${s}`);
    assert.ok(s.includes('Element not found'), s);
  });

  it('handles a replay that did nothing', () => {
    const s = summariseReplay({ replayed: 0, skipped: 0, failedAt: undefined });
    assert.ok(s.length > 0);
  });
});
