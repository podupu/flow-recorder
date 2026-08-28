const assert = require('assert');
const {
  parseSimctlApps,
  parseAndroidPackages,
  isAutomationApp
} = require('../../out/installedApps');

// Trimmed from a real `xcrun simctl listapps` on iPhone 17 Pro.
const SIMCTL = `{
    "com.apple.Fitness" =     {
        ApplicationType = System;
        CFBundleDisplayName = Fitness;
        CFBundleIdentifier = "com.apple.Fitness";
    };
    "com.conneqthealth.companion" =     {
        ApplicationType = User;
        CFBundleDisplayName = companion;
        CFBundleIdentifier = "com.conneqthealth.companion";
    };
    "com.facebook.WebDriverAgentRunner.xctrunner" =     {
        ApplicationType = User;
        CFBundleDisplayName = WebDriverAgentRunner;
        CFBundleIdentifier = "com.facebook.WebDriverAgentRunner.xctrunner";
    };
}`;

describe('parsing installed iOS apps', () => {
  it('finds user apps with their display name', () => {
    const apps = parseSimctlApps(SIMCTL);
    const companion = apps.find((a) => a.bundleId === 'com.conneqthealth.companion');
    assert.ok(companion, 'expected the user app');
    assert.strictEqual(companion.name, 'companion');
    assert.strictEqual(companion.isSystem, false);
  });

  it('marks Apple system apps as system', () => {
    const fitness = parseSimctlApps(SIMCTL).find((a) => a.bundleId === 'com.apple.Fitness');
    assert.strictEqual(fitness.isSystem, true);
  });

  it('returns apps sorted with user apps first', () => {
    const apps = parseSimctlApps(SIMCTL);
    assert.strictEqual(apps[0].isSystem, false);
  });

  it('survives empty or malformed output', () => {
    assert.deepStrictEqual(parseSimctlApps(''), []);
    assert.deepStrictEqual(parseSimctlApps('not a plist'), []);
    assert.deepStrictEqual(parseSimctlApps(undefined), []);
  });
});

describe('parsing installed Android packages', () => {
  it('strips the package: prefix', () => {
    const out = 'package:com.conneqthealth.conneqt\npackage:dev.mobile.maestro\n';
    assert.deepStrictEqual(parseAndroidPackages(out).map((a) => a.bundleId), [
      'com.conneqthealth.conneqt',
      'dev.mobile.maestro'
    ]);
  });

  it('ignores blank lines and noise', () => {
    assert.deepStrictEqual(parseAndroidPackages('\n  \nnot-a-package\n'), []);
  });

  it('handles empty input', () => {
    assert.deepStrictEqual(parseAndroidPackages(''), []);
    assert.deepStrictEqual(parseAndroidPackages(undefined), []);
  });
});

describe('filtering out automation harnesses', () => {
  it('recognises test runners and drivers, which are never the app under test', () => {
    assert.strictEqual(isAutomationApp('com.facebook.WebDriverAgentRunner.xctrunner'), true);
    assert.strictEqual(isAutomationApp('com.CardieX.ArtyGOUITests.xctrunner'), true);
    assert.strictEqual(isAutomationApp('dev.mobile.maestro'), true);
    assert.strictEqual(isAutomationApp('dev.mobile.maestro.test'), true);
    assert.strictEqual(isAutomationApp('io.appium.uiautomator2.server'), true);
  });

  it('leaves real apps alone', () => {
    assert.strictEqual(isAutomationApp('com.conneqthealth.companion'), false);
    assert.strictEqual(isAutomationApp('com.conneqthealth.conneqt'), false);
    assert.strictEqual(isAutomationApp('com.apple.Fitness'), false);
  });

  it('does not mistake a normal app containing "test"', () => {
    assert.strictEqual(isAutomationApp('com.acme.testkitchen'), false);
  });
});
