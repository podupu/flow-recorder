/**
 * End-to-end check of the real element-detection path against a live device.
 * Exercises the compiled extension code (out/), not a reimplementation.
 *
 *   node scripts/verify-hierarchy.js <deviceId>
 */
const adb = require('../out/android/adb');
const { parseUiNodes, findLabeledNodeAtPoint, resolveElementSelector, isSelectable } =
  require('../out/android/uiautomator');

const deviceId = process.argv[2] || 'emulator-5554';

function center(n) {
  return {
    x: Math.round((n.bounds.left + n.bounds.right) / 2),
    y: Math.round((n.bounds.top + n.bounds.bottom) / 2)
  };
}

(async () => {
  const screen = await adb.getScreenSize(deviceId);
  console.log(`screen: ${screen.width}x${screen.height}`);

  let xml;
  try {
    xml = await adb.dumpUiHierarchy(deviceId);
  } catch (err) {
    console.log(`\nDUMP FAILED (this is the diagnostic path)`);
    console.log(`  name:     ${err.name}`);
    console.log(`  reason:   ${err.reason}`);
    console.log(`  blockers: ${JSON.stringify(err.blockingServices)}`);
    console.log(`  message:  ${err.message}`);
    process.exit(2);
  }

  const nodes = parseUiNodes(xml);
  // Same payload the panel posts to the webview; hover hit-tests against these fractions.
  const payload = nodes.map((n, i) => {
    const c = center(n);
    return {
      elementId: i,
      text: n.text,
      resourceId: n.resourceId,
      left: n.bounds.left / screen.width,
      top: n.bounds.top / screen.height,
      width: (n.bounds.right - n.bounds.left) / screen.width,
      height: (n.bounds.bottom - n.bounds.top) / screen.height,
      selector: resolveElementSelector(n, c.x, c.y, screen),
      selectable: isSelectable(n, screen)
    };
  });

  console.log(`\nDUMP OK: ${xml.length} bytes, ${nodes.length} nodes, ${payload.filter((p) => p.selectable).length} selectable`);

  const inRange = payload.every(
    (p) => p.left >= 0 && p.top >= 0 && p.left + p.width <= 1.001 && p.top + p.height <= 1.001
  );
  console.log(`geometry within 0..1 fractions: ${inRange}`);

  console.log(`\nfirst labeled elements:`);
  for (const p of payload.filter((x) => x.selectable).slice(0, 8)) {
    console.log(`  #${p.elementId} ${JSON.stringify(p.selector)}`);
  }

  // Simulate hover at the centre of a real labeled element - what pointermove does.
  const target = payload.find((p) => p.selectable);
  if (target) {
    const hx = (target.left + target.width / 2) * screen.width;
    const hy = (target.top + target.height / 2) * screen.height;
    const hit = findLabeledNodeAtPoint(nodes, hx, hy);
    console.log(`\nhover hit-test at (${Math.round(hx)},${Math.round(hy)}):`);
    console.log(`  -> ${hit ? JSON.stringify(resolveElementSelector(hit, hx, hy, screen)) : 'NO HIT'}`);
    process.exit(hit ? 0 : 3);
  }
  console.log('\nno selectable elements found');
  process.exit(4);
})().catch((e) => {
  console.error('unexpected:', e);
  process.exit(1);
});
