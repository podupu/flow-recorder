const assert = require('assert');
const { extractSelectors, matchSelector, diagnoseFlow, suggestReplacement } = require('../../out/diagnose');

// Shape the drivers already produce.
const SCREEN = [
  { elementId: 0, text: 'Log In to Your Account', resourceId: undefined, left: 0.1, top: 0.1, width: 0.8, height: 0.05, selectable: true },
  { elementId: 1, text: 'Email Address', resourceId: 'com.app:id/email', left: 0.1, top: 0.3, width: 0.8, height: 0.06, selectable: true },
  { elementId: 2, text: undefined, resourceId: 'com.app:id/password_field', left: 0.1, top: 0.4, width: 0.8, height: 0.06, selectable: true },
  { elementId: 3, text: 'Sign In', resourceId: 'com.app:id/submit', left: 0.1, top: 0.55, width: 0.8, height: 0.07, selectable: true }
];

describe('extracting selectors from a flow', () => {
  it('finds selectors from every targeting command', () => {
    const steps = [
      'launchApp',
      { tapOn: { text: 'Sign In' } },
      { assertVisible: { text: 'Welcome' } },
      { longPressOn: { id: 'com.app:id/submit' } },
      { inputText: 'hello' }
    ];
    const found = extractSelectors(steps);
    assert.deepStrictEqual(found.map((f) => f.command), ['tapOn', 'assertVisible', 'longPressOn']);
    assert.deepStrictEqual(found[0].selector, { text: 'Sign In' });
  });

  it('records the step index so a report can point at the line', () => {
    const steps = ['launchApp', { tapOn: { text: 'A' } }];
    assert.strictEqual(extractSelectors(steps)[0].index, 1);
  });

  it('accepts the shorthand string form', () => {
    assert.deepStrictEqual(extractSelectors([{ tapOn: 'Sign In' }])[0].selector, { text: 'Sign In' });
  });

  it('ignores point selectors, which cannot go stale by name', () => {
    assert.deepStrictEqual(extractSelectors([{ tapOn: { point: '50%,50%' } }]), []);
  });

  it('ignores commands that take no selector', () => {
    assert.deepStrictEqual(extractSelectors(['back', { inputText: 'x' }, { pressKey: 'home' }]), []);
  });

  it('survives a malformed flow', () => {
    assert.deepStrictEqual(extractSelectors(null), []);
    assert.deepStrictEqual(extractSelectors([null, undefined, 42]), []);
  });
});

describe('matching a selector against the screen', () => {
  it('matches text exactly', () => {
    assert.strictEqual(matchSelector({ text: 'Sign In' }, SCREEN).elementId, 3);
  });

  it('matches id exactly', () => {
    assert.strictEqual(matchSelector({ id: 'com.app:id/email' }, SCREEN).elementId, 1);
  });

  it('returns undefined when nothing matches', () => {
    assert.strictEqual(matchSelector({ text: 'Log Out' }, SCREEN), undefined);
  });

  it('treats Maestro variables as unresolvable rather than broken', () => {
    // ${USERNAME} is substituted at run time, so it cannot be checked statically.
    assert.strictEqual(matchSelector({ text: '${USERNAME}' }, SCREEN), null);
  });
});

describe('suggesting a replacement', () => {
  it('suggests a close text match for a renamed label', () => {
    const s = suggestReplacement({ text: 'Sign in' }, SCREEN);
    assert.ok(s, 'expected a suggestion');
    assert.strictEqual(s.text, 'Sign In');
  });

  it('suggests an id that differs only by a rename', () => {
    const s = suggestReplacement({ id: 'com.app:id/password' }, SCREEN);
    assert.ok(s, 'expected a suggestion');
    assert.strictEqual(s.resourceId, 'com.app:id/password_field');
  });

  it('offers nothing when there is no plausible match', () => {
    assert.strictEqual(suggestReplacement({ text: 'Completely Unrelated Thing' }, SCREEN), undefined);
  });
});

describe('diagnosing a whole flow', () => {
  const steps = [
    'launchApp',
    { tapOn: { text: 'Email Address' } },        // matches
    { tapOn: { text: 'Sign in' } },              // broken: case changed
    { assertVisible: { id: 'com.app:id/gone' } },// broken: no suggestion
    { tapOn: { text: '${USER}' } },              // skipped: variable
    { tapOn: { point: '50%,50%' } }              // skipped: point
  ];

  it('separates matched, broken and skipped', () => {
    const r = diagnoseFlow(steps, SCREEN);
    assert.strictEqual(r.matched.length, 1);
    assert.strictEqual(r.broken.length, 2);
    assert.strictEqual(r.skipped.length, 1, 'only the variable is skipped; point is not extracted');
  });

  it('attaches a suggestion where one exists', () => {
    const r = diagnoseFlow(steps, SCREEN);
    const renamed = r.broken.find((b) => b.selector.text === 'Sign in');
    assert.ok(renamed.suggestion, 'expected a suggestion for the renamed label');
    assert.strictEqual(renamed.suggestion.text, 'Sign In');

    const missing = r.broken.find((b) => b.selector.id === 'com.app:id/gone');
    assert.strictEqual(missing.suggestion, undefined);
  });

  it('reports nothing broken for a healthy flow', () => {
    const r = diagnoseFlow([{ tapOn: { text: 'Sign In' } }], SCREEN);
    assert.deepStrictEqual(r.broken, []);
    assert.strictEqual(r.matched.length, 1);
  });

  it('reports every selector as broken against an empty screen', () => {
    const r = diagnoseFlow([{ tapOn: { text: 'Sign In' } }], []);
    assert.strictEqual(r.broken.length, 1);
  });
});

describe('resource id comparison', () => {
  // Regression: ids share long package prefixes, so whole-string similarity scores
  // com.app:id/gone against com.app:id/email at 0.69 and suggests an unrelated element.
  it('does not suggest an unrelated id that merely shares a package prefix', () => {
    assert.strictEqual(suggestReplacement({ id: 'com.app:id/gone' }, SCREEN), undefined);
  });

  it('still suggests a genuine suffix rename', () => {
    const s = suggestReplacement({ id: 'com.app:id/password' }, SCREEN);
    assert.ok(s);
    assert.strictEqual(s.resourceId, 'com.app:id/password_field');
  });

  it('compares only the local part, not the package', () => {
    const other = [{ elementId: 9, resourceId: 'com.totally.different.pkg:id/submit' }];
    const s = suggestReplacement({ id: 'com.app:id/submit' }, other);
    assert.ok(s, 'same local name should match across packages');
    assert.strictEqual(s.elementId, 9);
  });
});
