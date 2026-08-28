const assert = require('assert');
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');

/**
 * End-to-end test of the mirror webview: builds the real HTML the panel serves, runs the real
 * media/mirror.js inside a DOM, feeds it a real device payload, and inspects what was drawn.
 *
 * Every other test here checks a pure function. That left the actual overlay - the part the
 * user looks at - completely unobserved, and three consecutive "fixes" to it were verified
 * only by diffing files on disk. Those diffs passed while the panel rendered nothing of the
 * sort, because the running code was a stale cached build. This test closes that gap: it
 * exercises the same path the panel does, so a broken overlay fails here instead of silently
 * in the UI.
 */

const ROOT = path.join(__dirname, '..', '..');

function renderPanelHtml() {
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'vscode') {
      return {
        Uri: { joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath, ...segments) }) },
        ViewColumn: { Beside: 2 },
        window: {},
        workspace: { getConfiguration: () => ({ get: () => undefined }) }
      };
    }
    return original.apply(this, arguments);
  };
  try {
    const { MirrorPanel } = require('../../out/mirrorPanel');
    const panel = Object.create(MirrorPanel.prototype);
    panel.context = { extensionUri: { fsPath: ROOT } };
    panel.driver = { platform: 'iOS', deviceId: 'sim' };
    return panel.getHtml();
  } finally {
    Module._load = original;
  }
}

/** A signup screen shaped exactly like the real one this was debugged against. */
function signupElements() {
  const { parseIosElements } = require('../../out/ios/iosElements');
  const frame = (x, y, width, height) => ({ x, y, width, height });
  const raw = [
    { type: 'Application', AXLabel: 'CONNEQT', frame: frame(0, 0, 402, 874) },
    { type: 'Button', AXLabel: 'v1.8.7', frame: frame(168, 134, 65, 33) },
    { type: 'TextField', AXLabel: null, AXValue: 'First Name', frame: frame(36, 430, 289, 53) },
    { type: 'TextField', AXLabel: null, AXValue: 'Last Name', frame: frame(36, 503, 289, 53) },
    { type: 'TextField', AXLabel: null, AXValue: 'Email Address', frame: frame(36, 649, 289, 53) },
    { type: 'Button', AXLabel: 'Next', frame: frame(74, 744, 254, 48) }
  ];
  return parseIosElements(raw, { width: 402, height: 874 });
}

function mountMirror() {
  // 'outside-only' parses the document without auto-running the inline script, so the stubs
  // below exist before mirror.js executes. 'dangerously' would run it during parse, when
  // acquireVsCodeApi does not yet exist, and log a spurious ReferenceError.
  const dom = new JSDOM(renderPanelHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // The webview host object and canvas 2D context do not exist under jsdom; the overlay does
  // not depend on either, so stub just enough for the script to initialise.
  w.acquireVsCodeApi = () => ({ postMessage() {}, getState() {}, setState() {} });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  for (const script of w.document.querySelectorAll('script')) w.eval(script.textContent);
  return w;
}

function send(w, nodes, coverageNote) {
  w.postMessage({ type: 'elements', nodes, keyboard: null, coverageNote }, '*');
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('mirror overlay rendering', () => {
  it('draws a box for every element once a payload arrives', async () => {
    const w = mountMirror();
    const nodes = signupElements();
    await send(w, nodes);
    const boxes = w.document.getElementById('overlay').children;
    // Every element except the full-screen Application root.
    assert.strictEqual(boxes.length, nodes.length - 1);
  });

  it('numbers every box in reading order when show-all is toggled on', async () => {
    const w = mountMirror();
    await send(w, signupElements());
    w.document.getElementById('show-all-btn').dispatchEvent(new w.Event('click'));

    const overlay = w.document.getElementById('overlay');
    const badges = overlay.querySelectorAll('.element-badge');
    assert.strictEqual(badges.length, overlay.children.length, 'every box must carry a number');

    const numbers = Array.from(badges).map((b) => Number(b.textContent)).sort((a, b) => a - b);
    assert.deepStrictEqual(numbers, [1, 2, 3, 4, 5], 'numbers must be a gapless 1..n run');
  });

  it('marks the boxes show-all so they become visible', async () => {
    const w = mountMirror();
    await send(w, signupElements());
    const overlay = w.document.getElementById('overlay');
    assert.ok(!overlay.children[0].className.includes('show-all'), 'hidden until toggled');

    w.document.getElementById('show-all-btn').dispatchEvent(new w.Event('click'));
    assert.ok(overlay.children[0].className.includes('show-all'), 'outlined after toggle');
    assert.strictEqual(w.document.getElementById('show-all-btn').getAttribute('aria-pressed'), 'true');
  });

  it('positions boxes as percentages of the stage', async () => {
    const w = mountMirror();
    await send(w, signupElements());
    const style = w.document.getElementById('overlay').children[0].getAttribute('style');
    assert.match(style, /left: [\d.]+%/);
    assert.match(style, /top: [\d.]+%/);
    assert.match(style, /width: [\d.]+%/);
  });

  it('reports what it received and drew', async () => {
    const w = mountMirror();
    const nodes = signupElements();
    await send(w, nodes);
    const readout = w.document.getElementById('element-count').textContent;
    assert.strictEqual(readout, nodes.length + ' found / ' + (nodes.length - 1) + ' shown');
  });

  it('recovers unlabelled placeholder text so fields are selectable', async () => {
    // The AXValue fallback, observed through the overlay rather than the parser.
    const w = mountMirror();
    await send(w, signupElements());
    w.document.getElementById('show-all-btn').dispatchEvent(new w.Event('click'));
    assert.strictEqual(w.document.getElementById('overlay').children.length, 5);
  });

  it('shows a note when the app hides regions from accessibility', async () => {
    const { findAccessibilityGaps, describeGaps } = require('../../out/coverage');
    const w = mountMirror();
    const nodes = signupElements();
    const note = describeGaps(findAccessibilityGaps(nodes));
    assert.ok(note, 'this fixture has a hidden header band');

    const el = w.document.getElementById('coverage-note');
    assert.ok(el.classList.contains('hidden'), 'hidden before any payload');
    await send(w, nodes, note);
    assert.ok(!el.classList.contains('hidden'), 'note appears when regions are missing');
    assert.match(el.textContent, /no accessibility elements/);
  });

  it('keeps the note hidden on a screen with full coverage', async () => {
    const w = mountMirror();
    await send(w, signupElements(), undefined);
    assert.ok(w.document.getElementById('coverage-note').classList.contains('hidden'));
  });
});
