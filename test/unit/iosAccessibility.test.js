const assert = require('assert');
const cp = require('child_process');
const idb = require('../../out/ios/idb');
const { IosDriver } = require('../../out/ios/iosDriver');

const blank = [{ type: null, AXLabel: null, frame: { x: 0, y: 0, width: 0, height: 0 } }];
const valid = [{ type: 'Other', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { type: 'Button', AXLabel: 'Settings', frame: { x: 20, y: 100, width: 100, height: 40 } }];

describe('iOS accessibility backend compatibility', () => {
  let original;
  beforeEach(() => { original = cp.execFile; });
  afterEach(() => { cp.execFile = original; });

  it('falls back from the real zero-bounds failure and reuses the working bridge', async () => {
    const calls = [];
    cp.execFile = (_cmd, args, _options, cb) => {
      calls.push(args);
      cb(null, JSON.stringify(args.includes('axbridge') ? valid : blank), '');
    };
    const driver = new IosDriver('blank-ios27-test');
    assert.deepStrictEqual(await driver.screenSize(), { width: 402, height: 874 });
    const elements = await driver.elements();
    assert.strictEqual(elements[1].text, 'Settings');
    assert.strictEqual(calls.length, 3);
    assert.ok(calls.slice(1).every((args) => args.includes('axbridge')));
    assert.ok(calls.every((args) => !args.includes('button')), 'must never press Home to repair accessibility');
  });

  it('falls back from the modern companion translation error', async () => {
    cp.execFile = (_cmd, args, _options, cb) => args.includes('axbridge')
      ? cb(null, JSON.stringify(valid), '')
      : cb(new Error('AX failed'), '', 'No translation object returned for simulator');
    assert.deepStrictEqual(await idb.describeAll('translation-error-test'), valid);
  });

  it('keeps a working legacy backend without requiring a newer client', async () => {
    cp.execFile = (_cmd, args, _options, cb) => {
      assert.ok(!args.includes('--api'));
      cb(null, JSON.stringify(valid), '');
    };
    assert.deepStrictEqual(await idb.describeAll('legacy-working-test'), valid);
  });

  it('reports outdated tools rather than endlessly returning empty elements', async () => {
    cp.execFile = (_cmd, args, _options, cb) => args.includes('axbridge')
      ? cb(new Error('unsupported option'), '', 'unrecognized arguments: --api axbridge')
      : cb(null, JSON.stringify(blank), '');
    await assert.rejects(idb.describeAll('old-client-test'), /fb-idb and idb-companion 1\.5\.9/);
  });
});
