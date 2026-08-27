const assert = require('assert');
const {
  parseUiNodes,
  findSmallestNodeAtPoint,
  resolveElementSelector,
  filterSelectableNodes
} = require('../../out/android/uiautomator');

const XML = `<?xml version="1.0"?>
<hierarchy>
  <node text="Login" resource-id="" content-desc="" class="android.widget.Button" bounds="[10,20][200,90]"/>
  <node text="Email" resource-id="com.app:id/email" content-desc="" class="android.widget.EditText" bounds="[10,100][200,150]"/>
  <node text="" resource-id="" content-desc="Close" class="android.widget.ImageButton" bounds="[300,10][400,50]"/>
  <node text="" resource-id="" content-desc="" class="android.widget.FrameLayout" bounds="[0,0][1080,1920]"/>
</hierarchy>`;

describe('uiautomator', () => {
  it('parses nodes with bounds', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(nodes.length, 4);
    assert.deepStrictEqual(nodes[0].bounds, { left: 10, top: 20, right: 200, bottom: 90 });
  });

  it('finds the smallest node containing a point', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(findSmallestNodeAtPoint(nodes, 100, 60).text, 'Login');
  });

  it('resolves selector preferring text, then content-desc, then id, then point', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.deepStrictEqual(resolveElementSelector(nodes[0], 0, 0, screen), { text: 'Login' });
    assert.deepStrictEqual(resolveElementSelector(nodes[2], 0, 0, screen), { text: 'Close' });
    assert.deepStrictEqual(resolveElementSelector(nodes[3], 0, 0, screen), { point: '0%,0%' });
  });

  it('filters to selectable nodes', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    const sel = filterSelectableNodes(nodes, screen);
    assert.strictEqual(sel.length, 3);
    assert.deepStrictEqual(sel.map((n) => n.text), ['Login', 'Email', undefined]);
  });
});
