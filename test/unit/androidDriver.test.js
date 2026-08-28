const assert = require('assert');

describe('serialising concurrent hierarchy dumps', () => {
  // Reproduces the real failure: two `uiautomator dump` invocations on the same device race
  // for the single UiAutomation connection, and the loser is SIGKILLed (RC=137). The reporter
  // then blamed a phantom "other app" - dev.mobile.maestro never appeared in `ps -A` because
  // there was no leaked driver; it was the mirror colliding with itself (poll timer vs.
  // Replay vs. Diagnose Broken Selectors, all calling elements() independently).
  it('runs overlapping elements() calls one at a time, not concurrently', async () => {
    const { AndroidDriver } = require('../../out/android/androidDriver');
    const adb = require('../../out/android/adb');

    let inFlight = 0;
    let maxConcurrent = 0;
    const originalDump = adb.dumpUiHierarchy;
    const originalScreenSize = adb.getScreenSize;
    adb.getScreenSize = async () => ({ width: 1080, height: 2400 });
    adb.dumpUiHierarchy = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return '<hierarchy rotation="0"></hierarchy>';
    };

    try {
      const driver = new AndroidDriver('emulator-5554');
      // Three call sites hitting elements() at once: poll, Replay, Diagnose.
      await Promise.all([driver.elements(), driver.elements(), driver.elements()]);
      assert.strictEqual(maxConcurrent, 1, `expected serialised dumps, saw ${maxConcurrent} concurrent`);
    } finally {
      adb.dumpUiHierarchy = originalDump;
      adb.getScreenSize = originalScreenSize;
    }
  });

  it('one caller failing does not jam the queue for the next', async () => {
    const { AndroidDriver } = require('../../out/android/androidDriver');
    const adb = require('../../out/android/adb');

    const originalDump = adb.dumpUiHierarchy;
    const originalScreenSize = adb.getScreenSize;
    adb.getScreenSize = async () => ({ width: 1080, height: 2400 });
    let call = 0;
    adb.dumpUiHierarchy = async () => {
      call += 1;
      if (call === 1) throw new Error('Killed');
      return '<hierarchy rotation="0"></hierarchy>';
    };

    try {
      const driver = new AndroidDriver('emulator-5554');
      await assert.rejects(driver.elements());
      // The second call must still run, not hang behind a rejected first one.
      const els = await driver.elements();
      assert.deepStrictEqual(els, []);
    } finally {
      adb.dumpUiHierarchy = originalDump;
      adb.getScreenSize = originalScreenSize;
    }
  });
});
