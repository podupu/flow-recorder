const assert = require('assert');
const { parseRuntimeVersion, compareRuntimes, sortSimulators } = require('../../out/deviceSort');

describe('parsing a runtime version', () => {
  it('reads major and minor', () => {
    assert.deepStrictEqual(parseRuntimeVersion('iOS 26.5'), [26, 5]);
    assert.deepStrictEqual(parseRuntimeVersion('iOS 18.3'), [18, 3]);
  });

  it('handles a major-only runtime', () => {
    assert.deepStrictEqual(parseRuntimeVersion('iOS 26'), [26, 0]);
  });

  it('reads the raw simctl identifier too', () => {
    assert.deepStrictEqual(parseRuntimeVersion('com.apple.CoreSimulator.SimRuntime.iOS-26-5'), [26, 5]);
  });

  it('sorts unknown runtimes last rather than first', () => {
    assert.deepStrictEqual(parseRuntimeVersion('who knows'), [-1, -1]);
    assert.deepStrictEqual(parseRuntimeVersion(''), [-1, -1]);
  });

  it('does not compare versions as strings', () => {
    // "9" > "18" lexically; numerically it is not.
    assert.strictEqual(compareRuntimes('iOS 18.0', 'iOS 9.0') < 0, true);
  });
});

describe('ordering runtimes newest first', () => {
  it('puts a higher major first', () => {
    assert.ok(compareRuntimes('iOS 26.1', 'iOS 18.5') < 0);
  });

  it('breaks a major tie on minor', () => {
    assert.ok(compareRuntimes('iOS 26.5', 'iOS 26.1') < 0);
  });

  it('treats equal runtimes as equal', () => {
    assert.strictEqual(compareRuntimes('iOS 26.5', 'iOS 26.5'), 0);
  });

  it('sorts a real, unordered simctl list correctly', () => {
    // simctl returns runtimes in arbitrary order - this is the actual order observed.
    const raw = ['iOS 26.2', 'iOS 26.4', 'iOS 18.3', 'iOS 26.1', 'iOS 26.5', 'iOS 15.5'];
    assert.deepStrictEqual(raw.slice().sort(compareRuntimes), [
      'iOS 26.5',
      'iOS 26.4',
      'iOS 26.2',
      'iOS 26.1',
      'iOS 18.3',
      'iOS 15.5'
    ]);
  });
});

describe('ordering simulators for the picker', () => {
  const sims = [
    { udid: 'a', name: 'iPhone 15', runtime: 'iOS 18.3', booted: false },
    { udid: 'b', name: 'iPhone 17 Pro', runtime: 'iOS 26.5', booted: false },
    { udid: 'c', name: 'iPad Pro', runtime: 'iOS 15.5', booted: false },
    { udid: 'd', name: 'iPhone SE', runtime: 'iOS 15.5', booted: true },
    { udid: 'e', name: 'iPhone Air', runtime: 'iOS 26.5', booted: false }
  ];

  it('puts booted devices first regardless of version', () => {
    // A running device is what you almost certainly want, even on an old runtime.
    assert.strictEqual(sortSimulators(sims)[0].udid, 'd');
  });

  it('then orders by runtime, newest first', () => {
    const order = sortSimulators(sims).map((s) => s.runtime);
    assert.deepStrictEqual(order, ['iOS 15.5', 'iOS 26.5', 'iOS 26.5', 'iOS 18.3', 'iOS 15.5']);
  });

  it('sorts by name within the same runtime', () => {
    const same = sortSimulators(sims).filter((s) => !s.booted && s.runtime === 'iOS 26.5');
    assert.deepStrictEqual(same.map((s) => s.name), ['iPhone 17 Pro', 'iPhone Air']);
  });

  it('sorts device numbers numerically, not lexically', () => {
    // Plain localeCompare gives iPhone 15, iPhone 17 Pro, iPhone 9 - which reads as a bug.
    const numbered = [
      { udid: '1', name: 'iPhone 9', runtime: 'iOS 26.5', booted: false },
      { udid: '2', name: 'iPhone 17 Pro', runtime: 'iOS 26.5', booted: false },
      { udid: '3', name: 'iPhone 15', runtime: 'iOS 26.5', booted: false }
    ];
    assert.deepStrictEqual(sortSimulators(numbered).map((s) => s.name), [
      'iPhone 9',
      'iPhone 15',
      'iPhone 17 Pro'
    ]);
  });

  it('does not mutate the input', () => {
    const copy = sims.slice();
    sortSimulators(sims);
    assert.deepStrictEqual(sims, copy);
  });

  it('handles an empty list', () => {
    assert.deepStrictEqual(sortSimulators([]), []);
  });
});
