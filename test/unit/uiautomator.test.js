const assert = require('assert');
const {
  parseUiNodes,
  isSelectable,
  findLabeledNodeAtPoint,
  resolveElementSelector
} = require('../../out/android/uiautomator');

const XML = `<hierarchy>
  <node text="" resource-id="" content-desc="" class="android.widget.LinearLayout" bounds="[0,0][1080,1920]">
    <node text="Settings" resource-id="" content-desc="" class="android.widget.Button" bounds="[0,0][200,100]">
      <node text="" resource-id="" content-desc="" class="android.widget.View" bounds="[0,0][200,100]"/>
    </node>
    <node text="" resource-id="com.app:id/email" content-desc="" class="android.widget.EditText" bounds="[10,100][200,150]"/>
  </node>
</hierarchy>`;

describe('uiautomator', () => {
  it('parses nodes with parent links', () => {
    const nodes = parseUiNodes(XML);
    assert.strictEqual(nodes.length, 4);
    assert.strictEqual(nodes[0].parentId, -1);
    assert.strictEqual(nodes[1].parentId, 0);
    assert.strictEqual(nodes[2].parentId, 1);
    assert.strictEqual(nodes[3].parentId, 0);
  });

  it('walks up to the nearest labeled ancestor at a point', () => {
    const nodes = parseUiNodes(XML);
    const n = findLabeledNodeAtPoint(nodes, 100, 50);
    assert.strictEqual(n.text, 'Settings');
  });

  it('returns the labeled node itself when deepest is labeled', () => {
    const nodes = parseUiNodes(XML);
    const n = findLabeledNodeAtPoint(nodes, 100, 125);
    assert.strictEqual(n.resourceId, 'com.app:id/email');
  });

  it('isSelectable filters by label and size', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.strictEqual(isSelectable(nodes[0], screen), false);
    assert.strictEqual(isSelectable(nodes[1], screen), true);
    assert.strictEqual(isSelectable(nodes[2], screen), false);
  });

  it('resolves selector preferring text, then content-desc, then id, then point', () => {
    const nodes = parseUiNodes(XML);
    const screen = { width: 1080, height: 1920 };
    assert.deepStrictEqual(resolveElementSelector(nodes[1], 0, 0, screen), { text: 'Settings' });
    assert.deepStrictEqual(resolveElementSelector(nodes[3], 0, 0, screen), { id: 'com.app:id/email' });
    assert.deepStrictEqual(resolveElementSelector(nodes[0], 0, 0, screen), { point: '0%,0%' });
  });
});
