const assert = require('assert');
const childProcess = require('child_process');
const { bootSimulator } = require('../../out/ios/idb');

describe('iOS simulator boot readiness', () => {
  let original;
  beforeEach(() => { original = childProcess.execFile; });
  afterEach(() => { childProcess.execFile = original; });

  it('does not resolve until bootstatus finishes and can boot an unstarted device', async () => {
    let finish;
    childProcess.execFile = (command, args, options, callback) => {
      assert.strictEqual(command, 'xcrun');
      assert.deepStrictEqual(args, ['simctl', 'bootstatus', 'test-udid', '-b']);
      assert.strictEqual(options.timeout, 180000);
      finish = callback;
    };
    let ready = false;
    const boot = bootSimulator('test-udid').then(() => { ready = true; });
    await Promise.resolve();
    assert.strictEqual(ready, false);
    finish(null, 'Finished', '');
    await boot;
    assert.strictEqual(ready, true);
  });

  it('preserves a startup failure and suggests checking Simulator instead of unlocking it', async () => {
    childProcess.execFile = (_command, _args, _options, callback) => {
      callback(new Error('Timed out'), '', 'Runtime startup failed');
    };
    await assert.rejects(bootSimulator('test-udid'), (error) => {
      assert.match(error.message, /Open Simulator/);
      assert.match(error.message, /Runtime startup failed/);
      assert.doesNotMatch(error.message, /locked/);
      return true;
    });
  });
});
