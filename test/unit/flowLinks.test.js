const assert = require('assert');
const { findFlowLinks } = require('../../out/flowLinks');

function linksIn(text) {
  return findFlowLinks(text).map((l) => ({ line: l.line, path: l.path }));
}

describe('finding linkable paths in a flow', () => {
  it('links a runFlow path', () => {
    const text = ['appId: com.x', '---', '- runFlow: subflows/demographics.flow.yaml'].join('\n');
    assert.deepStrictEqual(linksIn(text), [{ line: 2, path: 'subflows/demographics.flow.yaml' }]);
  });

  it('links runScript and takeScreenshot', () => {
    const text = ['- runScript: scripts/api-1.js', '- takeScreenshot: assets/step-2.png'].join('\n');
    assert.deepStrictEqual(linksIn(text), [
      { line: 0, path: 'scripts/api-1.js' },
      { line: 1, path: 'assets/step-2.png' }
    ]);
  });

  it('links the nested file: form of runFlow', () => {
    const text = ['- runFlow:', '    file: subflows/login.flow.yaml', '    when:', '      visible: Login'].join('\n');
    assert.deepStrictEqual(linksIn(text), [{ line: 1, path: 'subflows/login.flow.yaml' }]);
  });

  it('reports the exact column span of the path', () => {
    const line = '- runFlow: subflows/demographics.flow.yaml';
    const [link] = findFlowLinks(line);
    assert.strictEqual(line.slice(link.startCol, link.endCol), 'subflows/demographics.flow.yaml');
  });

  it('strips surrounding quotes but links the inner path', () => {
    const line = '- runFlow: "subflows/a b.flow.yaml"';
    const [link] = findFlowLinks(line);
    assert.strictEqual(link.path, 'subflows/a b.flow.yaml');
    assert.strictEqual(line.slice(link.startCol, link.endCol), 'subflows/a b.flow.yaml');
  });

  it('handles indented steps inside a nested block', () => {
    const text = ['- repeat:', '    commands:', '      - runFlow: subflows/inner.flow.yaml'].join('\n');
    assert.deepStrictEqual(linksIn(text), [{ line: 2, path: 'subflows/inner.flow.yaml' }]);
  });

  it('ignores maestro expressions, which are not paths', () => {
    const text = [
      '- takeScreenshot: ${output.name}',
      '- runFlow: ${output.flowPath}',
      '- assertTrue: ${output.api1.status == 200}'
    ].join('\n');
    assert.deepStrictEqual(linksIn(text), []);
  });

  it('ignores commands that are not path-bearing', () => {
    const text = ['- tapOn: Login', '- inputText: subflows/not-a-path', '- pressKey: home'].join('\n');
    assert.deepStrictEqual(linksIn(text), []);
  });

  it('ignores a commented-out line', () => {
    assert.deepStrictEqual(linksIn('# - runFlow: subflows/old.flow.yaml'), []);
  });

  it('ignores an empty value', () => {
    assert.deepStrictEqual(linksIn('- runFlow:'), []);
  });

  it('drops a trailing inline comment', () => {
    const [link] = findFlowLinks('- runFlow: subflows/a.flow.yaml   # legacy');
    assert.strictEqual(link.path, 'subflows/a.flow.yaml');
  });

  it('finds several links across a whole flow', () => {
    const text = [
      'appId: com.x',
      '---',
      '- launchApp',
      '- runFlow: subflows/demographics.flow.yaml',
      '- takeScreenshot: assets/a.png',
      '- runScript: scripts/api-1.js'
    ].join('\n');
    assert.strictEqual(findFlowLinks(text).length, 3);
  });
});

describe('link metadata', () => {
  const { findFlowLinks } = require('../../out/flowLinks');

  it('reports which command each path came from', () => {
    const text = ['- runFlow: a.flow.yaml', '- takeScreenshot: b.png', '- runScript: c.js'].join('\n');
    assert.deepStrictEqual(findFlowLinks(text).map((l) => l.key), [
      'runFlow',
      'takeScreenshot',
      'runScript'
    ]);
  });

  it('reports `file` for the nested runFlow form', () => {
    assert.strictEqual(findFlowLinks('- runFlow:\n    file: x.flow.yaml')[0].key, 'file');
  });
});
