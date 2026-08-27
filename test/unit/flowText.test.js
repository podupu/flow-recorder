const assert = require('assert');
const { stepToYamlItem, stepsToYamlItems, insertionLine } = require('../../out/flowText');

describe('serialising a step to a YAML list item', () => {
  it('renders a mapping step', () => {
    assert.strictEqual(stepToYamlItem({ tapOn: { text: 'Login' } }), '- tapOn:\n    text: Login\n');
  });

  it('renders a bare string step', () => {
    assert.strictEqual(stepToYamlItem('back'), '- back\n');
  });

  it('renders a scalar-valued step', () => {
    assert.strictEqual(stepToYamlItem({ takeScreenshot: 'assets/a.png' }), '- takeScreenshot: assets/a.png\n');
  });

  it('does not wrap long expressions', () => {
    // yaml.dump folds long lines by default, which would corrupt a ${...} expression.
    const long = { evalScript: "${output.api1 = http.get('https://staging.api.portal.myconneqt.com/api/v1/resource')}" };
    const out = stepToYamlItem(long);
    assert.strictEqual(out.split('\n').filter((l) => l.trim()).length, 1, 'must stay on one line');
    assert.ok(out.includes('https://staging.api.portal.myconneqt.com/api/v1/resource'));
  });

  it('joins several steps in order', () => {
    const out = stepsToYamlItems([{ runScript: 'scripts/a.js' }, { assertTrue: '${output.x == 200}' }]);
    assert.ok(out.indexOf('runScript') < out.indexOf('assertTrue'));
    assert.ok(out.endsWith('\n'));
  });
});

describe('choosing the insertion line', () => {
  const lines = [
    'appId: com.example.app', //  0
    '---', //                     1
    '- launchApp', //             2
    '- tapOn:', //                3
    '    text: Login', //         4
    '- takeScreenshot: a.png' //  5
  ];

  it('inserts after the step the cursor sits on', () => {
    assert.strictEqual(insertionLine(lines, 2), 3);
  });

  it('inserts after the whole step when the cursor is on a child line', () => {
    // Cursor inside `tapOn:` should not split the mapping.
    assert.strictEqual(insertionLine(lines, 4), 5);
  });

  it('appends when the cursor is on the last step', () => {
    assert.strictEqual(insertionLine(lines, 5), lines.length);
  });

  it('inserts at the top of the steps when the cursor is in the header', () => {
    assert.strictEqual(insertionLine(lines, 0), 2);
    assert.strictEqual(insertionLine(lines, 1), 2);
  });

  it('handles a flow with no steps yet', () => {
    assert.strictEqual(insertionLine(['appId: x', '---'], 1), 2);
  });

  it('handles a flow with no document separator', () => {
    const noSep = ['- launchApp', '- back'];
    assert.strictEqual(insertionLine(noSep, 0), 1);
  });

  it('never returns a line outside the document', () => {
    const n = insertionLine(lines, 99);
    assert.ok(n >= 0 && n <= lines.length, `${n} out of range`);
  });
});
