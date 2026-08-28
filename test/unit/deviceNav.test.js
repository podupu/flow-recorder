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

describe('platform-specific nav bars', () => {
  const { navButtonsFor, navActionSpecFor } = require('../../out/deviceNav');

  it('Android shows the three system buttons', () => {
    assert.deepStrictEqual(navButtonsFor('Android').map((b) => b.action), [
      'back',
      'home',
      'recents',
      'reload'
    ]);
  });

  it('iOS omits Back and swaps Recents for App Switcher', () => {
    // iOS has no system Back or Recents key. Back is a left-edge swipe performed on the
    // mirror itself, so a button would imply hardware that does not exist.
    assert.deepStrictEqual(navButtonsFor('iOS').map((b) => b.action), [
      'home',
      'appSwitcher',
      'lock',
      'reload'
    ]);
  });

  it('keeps Back on Android, where it is a real system button', () => {
    assert.ok(navButtonsFor('Android').some((b) => b.action === 'back'));
  });

  it('gives every button a label and an icon', () => {
    for (const platform of ['Android', 'iOS']) {
      for (const b of navButtonsFor(platform)) {
        assert.ok(b.label, `${platform}/${b.action} needs a label`);
        assert.ok(b.icon.includes('<svg'), `${platform}/${b.action} needs an icon`);
        assert.ok(b.title, `${platform}/${b.action} needs a tooltip`);
      }
    }
  });

  it('still supports an iOS back gesture even though the bar has no button', () => {
    // The action remains available to the driver and the context menu.
    const spec = navActionSpecFor('back', 'iOS');
    assert.strictEqual(spec.gesture, 'edgeSwipeBack');
    assert.strictEqual(spec.step, 'back');
  });

  it('records Lock on iOS, which is a real Maestro key', () => {
    assert.deepStrictEqual(navActionSpecFor('lock', 'iOS').step, { pressKey: 'lock' });
  });

  it('does not record the app switcher on either platform', () => {
    assert.strictEqual(navActionSpecFor('appSwitcher', 'iOS').step, null);
    assert.strictEqual(navActionSpecFor('recents', 'Android').step, null);
  });

  it('keeps Android keycodes and iOS gestures apart', () => {
    // Android drives Back with a keycode; iOS has none and uses an edge swipe instead.
    assert.strictEqual(navActionSpecFor('back', 'Android').keycode, 4);
    assert.strictEqual(navActionSpecFor('back', 'iOS').keycode, null);
    assert.strictEqual(navActionSpecFor('back', 'iOS').gesture, 'edgeSwipeBack');
  });

  it('reload never touches the device on either platform', () => {
    for (const p of ['Android', 'iOS']) {
      const s = navActionSpecFor('reload', p);
      assert.strictEqual(s.keycode, null);
      assert.strictEqual(s.step, null);
    }
  });
});
