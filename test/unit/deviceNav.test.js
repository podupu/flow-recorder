const assert = require('assert');
const { navActionSpec, isNavAction, NAV_ACTIONS } = require('../../out/deviceNav');

describe('device nav bar actions', () => {
  it('exposes the four nav-bar actions', () => {
    assert.deepStrictEqual(NAV_ACTIONS, ['back', 'home', 'recents', 'reload']);
  });

  it('recognises only known actions', () => {
    assert.strictEqual(isNavAction('back'), true);
    assert.strictEqual(isNavAction('recents'), true);
    assert.strictEqual(isNavAction('screenshot'), false);
    assert.strictEqual(isNavAction(''), false);
  });

  it('back injects KEYCODE_BACK and records the Maestro `back` command', () => {
    const spec = navActionSpec('back');
    assert.strictEqual(spec.keycode, 4);
    assert.strictEqual(spec.step, 'back');
  });

  it('home injects KEYCODE_HOME and records pressKey: home', () => {
    const spec = navActionSpec('home');
    assert.strictEqual(spec.keycode, 3);
    assert.deepStrictEqual(spec.step, { pressKey: 'home' });
  });

  it('recents drives the device but records nothing', () => {
    // Maestro has no app-switch command, so recording one would produce an unplayable flow.
    const spec = navActionSpec('recents');
    assert.strictEqual(spec.keycode, 187);
    assert.strictEqual(spec.step, null);
  });

  it('reload touches neither the device nor the flow', () => {
    const spec = navActionSpec('reload');
    assert.strictEqual(spec.keycode, null);
    assert.strictEqual(spec.step, null);
  });

  it('rejects unknown actions rather than silently no-oping', () => {
    assert.throws(() => navActionSpec('fly'));
  });

  it('never records a step without a keycode to go with it', () => {
    for (const action of NAV_ACTIONS) {
      const spec = navActionSpec(action);
      if (spec.step !== null) {
        assert.ok(spec.keycode !== null, `${action} records a step but injects no key`);
      }
    }
  });
});
