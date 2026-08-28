const assert = require('assert');
const { DEFAULT_FLOW_PATTERNS, isFlowFile, globToRegExp } = require('../../out/flowFiles');

describe('default flow patterns', () => {
  it('matches Maestro\'s own file convention', () => {
    // From the official SchemaStore entry for Maestro Flow.
    assert.deepStrictEqual(DEFAULT_FLOW_PATTERNS, [
      '**/*.flow.yaml',
      '**/*.flow.yml',
      '**/.maestro/**/*.yaml',
      '**/.maestro/**/*.yml'
    ]);
  });
});

describe('glob matching', () => {
  const m = (glob, path) => globToRegExp(glob).test(path);

  it('matches * within a single segment only', () => {
    assert.strictEqual(m('*.yaml', 'a.yaml'), true);
    assert.strictEqual(m('*.yaml', 'dir/a.yaml'), false);
  });

  it('lets **/ match zero or more directories', () => {
    assert.strictEqual(m('**/*.flow.yaml', 'login.flow.yaml'), true);
    assert.strictEqual(m('**/*.flow.yaml', 'e2e/login.flow.yaml'), true);
    assert.strictEqual(m('**/*.flow.yaml', 'a/b/c/login.flow.yaml'), true);
  });

  it('escapes dots so they are literal', () => {
    assert.strictEqual(m('**/*.flow.yaml', 'loginXflowXyaml'), false);
  });

  it('anchors the whole path', () => {
    assert.strictEqual(m('**/*.yaml', 'a.yaml.bak'), false);
  });

  it('handles a directory in the middle', () => {
    assert.strictEqual(m('**/.maestro/**/*.yaml', '.maestro/login.yaml'), true);
    assert.strictEqual(m('**/.maestro/**/*.yaml', 'app/.maestro/flows/login.yaml'), true);
    assert.strictEqual(m('**/.maestro/**/*.yaml', 'app/flows/login.yaml'), false);
  });
});

describe('identifying a flow file', () => {
  it('accepts the .flow.yaml convention anywhere', () => {
    assert.strictEqual(isFlowFile('/w/examples/login.flow.yaml'), true);
    assert.strictEqual(isFlowFile('/w/login.flow.yml'), true);
  });

  it('accepts a plain .yaml inside a .maestro directory', () => {
    // This is the case the old hardcoded check missed entirely.
    assert.strictEqual(isFlowFile('/w/.maestro/login.yaml'), true);
    assert.strictEqual(isFlowFile('/w/app/.maestro/flows/checkout.yml'), true);
  });

  it('rejects unrelated yaml, which is the whole point', () => {
    assert.strictEqual(isFlowFile('/w/docker-compose.yaml'), false);
    assert.strictEqual(isFlowFile('/w/.github/workflows/ci.yaml'), false);
    assert.strictEqual(isFlowFile('/w/k8s/deployment.yaml'), false);
    assert.strictEqual(isFlowFile('/w/config.yml'), false);
  });

  it('rejects non-yaml files', () => {
    assert.strictEqual(isFlowFile('/w/README.md'), false);
    assert.strictEqual(isFlowFile('/w/flow.yaml.bak'), false);
  });

  it('honours custom patterns when a team uses another layout', () => {
    const custom = ['e2e-tests/**/*.yaml'];
    assert.strictEqual(isFlowFile('/w/e2e-tests/login.yaml', custom), true);
    assert.strictEqual(isFlowFile('/w/e2e-tests/deep/login.yaml', custom), true);
    // Custom patterns replace the defaults rather than adding to them.
    assert.strictEqual(isFlowFile('/w/other/login.flow.yaml', custom), false);
  });

  it('normalises Windows separators', () => {
    assert.strictEqual(isFlowFile('C:\\work\\examples\\login.flow.yaml'), true);
  });

  it('handles empty or missing input', () => {
    assert.strictEqual(isFlowFile(''), false);
    assert.strictEqual(isFlowFile(undefined), false);
    assert.strictEqual(isFlowFile('/w/a.flow.yaml', []), false);
  });
});

describe('suffix matching does not over-match', () => {
  it('only matches at a directory boundary', () => {
    // "e2e-tests" must be a whole segment, not part of "old-e2e-tests".
    assert.strictEqual(isFlowFile('/w/old-e2e-tests/login.yaml', ['e2e-tests/**/*.yaml']), false);
    assert.strictEqual(isFlowFile('/w/e2e-tests/login.yaml', ['e2e-tests/**/*.yaml']), true);
  });

  it('still rejects unrelated yaml under the defaults', () => {
    assert.strictEqual(isFlowFile('/w/deep/nested/docker-compose.yaml'), false);
  });
});
