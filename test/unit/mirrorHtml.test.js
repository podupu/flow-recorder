const assert = require('assert');
const path = require('path');
const Module = require('module');

/**
 * The mirror webview must INLINE its JS and CSS rather than link them as separate resources.
 *
 * This is not a style preference. VS Code's webview service worker caches resources on disk,
 * keyed by URI, and that cache survives window reloads, editor restarts and extension
 * reinstalls. While the extension version stayed at 0.1.0 the asset URIs never changed, so the
 * panel kept executing the FIRST build's mirror.js indefinitely - several consecutive fixes to
 * the overlay landed on disk and had no effect whatsoever, because the code running was never
 * the code being edited. Diagnosing that a second time would be expensive, so the shape of the
 * generated HTML is pinned here.
 *
 * See https://github.com/openai/codex/issues/33032 for the same failure in another extension.
 */

function loadMirrorPanelWithStubbedVscode() {
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
    return require('../../out/mirrorPanel').MirrorPanel;
  } finally {
    Module._load = original;
  }
}

function renderHtml() {
  const MirrorPanel = loadMirrorPanelWithStubbedVscode();
  // getHtml only touches the extension root and the driver label, so a bare instance is enough.
  const panel = Object.create(MirrorPanel.prototype);
  panel.context = { extensionUri: { fsPath: path.join(__dirname, '..', '..') } };
  panel.driver = { platform: 'iOS', deviceId: 'test-device' };
  return panel.getHtml();
}

describe('mirror webview html', () => {
  it('inlines the stylesheet instead of linking it', () => {
    const html = renderHtml();
    assert.ok(!/<link[^>]+stylesheet/i.test(html), 'must not <link> a cacheable stylesheet');
    assert.ok(html.includes('.element-badge'), 'real CSS should be present in the document');
  });

  it('inlines the script instead of referencing a src', () => {
    const html = renderHtml();
    assert.ok(!/<script[^>]+src=/i.test(html), 'must not load mirror.js as a cacheable resource');
    assert.ok(html.includes('sortByReadingOrder'), 'real JS should be present in the document');
  });

  it('carries the current overlay logic, not a stale copy', () => {
    // Reads from the same media/ files the panel ships, so an edit that never reaches the
    // webview fails here rather than silently in the UI.
    const html = renderHtml();
    assert.ok(html.includes('nearFullscreen'), 'show-all filter must be in the served document');
  });

  it('neutralises a closing script tag inside an asset', () => {
    // A `</script` in the payload would end the wrapping tag early and truncate the panel.
    const html = renderHtml();
    const body = html.slice(html.indexOf('<script>'));
    const closers = body.match(/<\/script/gi) || [];
    assert.strictEqual(closers.length, 1, 'exactly one real closing tag should survive');
  });
});
