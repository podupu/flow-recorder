const assert = require('assert');
const Module = require('module');

function makePanel(driver) {
  const original = Module._load;
  const modulePath = require.resolve('../../out/mirrorPanel');
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  Module._load = function (request) {
    if (request === 'vscode') return { window: { showWarningMessage() {} } };
    return original.apply(this, arguments);
  };
  let MirrorPanel;
  try {
    MirrorPanel = require(modulePath).MirrorPanel;
  } finally {
    Module._load = original;
    delete require.cache[modulePath];
    if (cached) require.cache[modulePath] = cached;
  }
  const panel = Object.create(MirrorPanel.prototype);
  const messages = [];
  Object.assign(panel, {
    driver, allElements: [], disposed: false, dumping: false,
    panel: { webview: { postMessage: (message) => messages.push(message) } }
  });
  return { panel, messages };
}

describe('mirror recovery', () => {
  it('controls the device without writing until recording is explicitly enabled', async () => {
    const taps = [];
    const steps = [];
    const { panel } = makePanel({ tap: async (x, y) => taps.push([x, y]) });
    panel.screenSize = { width: 402, height: 874 };
    panel.refreshElements = async () => {};
    panel.writeStep = async (step) => steps.push(step);
    await panel.handleRawTap(0.5, 0.5);
    assert.strictEqual(taps.length, 1);
    assert.strictEqual(steps.length, 0);
    await panel.handleMessage({ type: 'setRecording', value: true });
    await panel.handleRawTap(0.5, 0.5);
    assert.strictEqual(steps.length, 1);
    await panel.handleMessage({ type: 'setRecording', value: false });
    await panel.handleRawTap(0.5, 0.5);
    assert.strictEqual(taps.length, 3);
    assert.strictEqual(steps.length, 1);
  });
  it('records launchApp without leaking the runtime app id into the flow', async () => {
    const launches = [];
    const steps = [];
    const { panel } = makePanel({
      clearState: async () => {},
      launchApp: async (appId) => launches.push(appId)
    });
    panel.screenSize = { width: 402, height: 874 };
    panel.recording = true;
    panel.resolveAppId = async () => 'org.wikipedia';
    panel.writeStep = async (step) => steps.push(step);

    await panel.handleLaunchApp(false);
    await panel.handleLaunchApp(true);

    assert.deepStrictEqual(launches, ['org.wikipedia', 'org.wikipedia']);
    assert.deepStrictEqual(steps, [{ launchApp: null }, { launchApp: { clearState: true } }]);
  });
  it('retries a failed initial screen-size lookup and resumes elements without reopening', async () => {
    let attempts = 0;
    const size = { width: 402, height: 874 };
    const nodes = [{ elementId: 0, text: 'Sign in' }];
    const { panel, messages } = makePanel({
      screenSize: async () => {
        if (++attempts === 1) throw new Error('Accessibility bounds unavailable');
        return size;
      },
      elements: async () => nodes,
      keyboardRegion: async () => null,
      recoverableDriversFor: () => []
    });
    await panel.refreshElements();
    assert.strictEqual(panel.screenSize, undefined);
    assert.ok(messages.some((m) => m.type === 'hierarchyError'));
    await panel.refreshElements();
    assert.deepStrictEqual(panel.screenSize, size);
    assert.ok(messages.some((m) => m.type === 'elements'));
    assert.ok(messages.some((m) => m.type === 'hierarchyOk'));
    assert.strictEqual(panel.hierarchyProblem, undefined);
  });

  it('starts screenshots without waiting for an accessibility lookup', async () => {
    const { panel } = makePanel({ screenSize: () => { throw new Error('must not gate startup'); } });
    const started = [];
    panel.postTarget = () => {};
    panel.startPolling = () => started.push('screenshots');
    panel.startElementPolling = () => started.push('elements');
    await panel.init();
    assert.deepStrictEqual(started, ['screenshots', 'elements']);
  });

  it('reports capture failure once and clears it after recovery', async () => {
    let failing = true;
    const { panel, messages } = makePanel({ screenshot: async () => {
      if (failing) throw new Error('Simulator unavailable');
      return Buffer.from('frame');
    } });
    await panel.pushFrame();
    await panel.pushFrame();
    assert.strictEqual(messages.filter((m) => m.type === 'frameError').length, 1);
    failing = false;
    await panel.pushFrame();
    assert.ok(messages.some((m) => m.type === 'frame'));
    assert.ok(messages.some((m) => m.type === 'frameOk'));
  });
});
