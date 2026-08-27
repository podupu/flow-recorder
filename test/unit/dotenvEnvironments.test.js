const assert = require('assert');
const {
  parseDotenv,
  environmentNameFromFile,
  isEnvFile,
  platformFromName,
  mergeEnvironment,
  BASE_ENV_FILE
} = require('../../out/dotenvEnvironments');

describe('parsing .env content', () => {
  it('reads simple pairs', () => {
    assert.deepStrictEqual(parseDotenv('A=1\nB=two'), { A: '1', B: 'two' });
  });

  it('ignores comments and blank lines', () => {
    assert.deepStrictEqual(parseDotenv('# a comment\n\nA=1\n   \n# another\nB=2'), { A: '1', B: '2' });
  });

  it('accepts the export prefix', () => {
    assert.deepStrictEqual(parseDotenv('export A=1'), { A: '1' });
  });

  it('strips matching quotes', () => {
    assert.deepStrictEqual(parseDotenv('A="hello world"\nB=\'single\''), {
      A: 'hello world',
      B: 'single'
    });
  });

  it('keeps = inside a value', () => {
    // Base64 credentials routinely end in '=' padding.
    assert.deepStrictEqual(parseDotenv('TOKEN=abc=def=='), { TOKEN: 'abc=def==' });
  });

  it('trims whitespace around the key and unquoted value', () => {
    assert.deepStrictEqual(parseDotenv('  A  =  1  '), { A: '1' });
  });

  it('preserves whitespace inside quotes', () => {
    assert.deepStrictEqual(parseDotenv('A="  padded  "'), { A: '  padded  ' });
  });

  it('drops an inline comment after an unquoted value', () => {
    assert.deepStrictEqual(parseDotenv('A=1 # why'), { A: '1' });
  });

  it('keeps a # inside a quoted value', () => {
    assert.deepStrictEqual(parseDotenv('A="a#b"'), { A: 'a#b' });
  });

  it('skips malformed lines rather than throwing', () => {
    assert.deepStrictEqual(parseDotenv('novalue\nA=1\n=noKey'), { A: '1' });
  });

  it('handles empty input', () => {
    assert.deepStrictEqual(parseDotenv(''), {});
  });
});

describe('discovering environments from filenames', () => {
  it('recognises env files', () => {
    assert.strictEqual(isEnvFile('.env'), true);
    assert.strictEqual(isEnvFile('.env.android'), true);
    assert.strictEqual(isEnvFile('.env.staging.android'), true);
    assert.strictEqual(isEnvFile('env.android'), false);
    assert.strictEqual(isEnvFile('.environment'), false);
    assert.strictEqual(isEnvFile('README.md'), false);
  });

  it('derives the environment name from the suffix', () => {
    assert.strictEqual(environmentNameFromFile('.env.android'), 'android');
    assert.strictEqual(environmentNameFromFile('.env.iOS_V2'), 'iOS_V2');
    assert.strictEqual(environmentNameFromFile('.env.staging.android'), 'staging.android');
  });

  it('treats a bare .env as the shared base, not an environment', () => {
    assert.strictEqual(environmentNameFromFile(BASE_ENV_FILE), undefined);
  });

  it('ignores example and sample templates', () => {
    assert.strictEqual(isEnvFile('.env.example'), false);
    assert.strictEqual(isEnvFile('.env.sample'), false);
  });
});

describe('inferring platform from the environment name', () => {
  it('detects android and ios in any case', () => {
    assert.strictEqual(platformFromName('android'), 'Android');
    assert.strictEqual(platformFromName('android_V2'), 'Android');
    assert.strictEqual(platformFromName('iOS'), 'iOS');
    assert.strictEqual(platformFromName('staging.ios'), 'iOS');
  });

  it('returns undefined when the name says nothing about platform', () => {
    assert.strictEqual(platformFromName('staging'), undefined);
    assert.strictEqual(platformFromName('prod'), undefined);
  });

  it('does not mistake a substring for a platform', () => {
    assert.strictEqual(platformFromName('androidx-lib'), 'Android');
    assert.strictEqual(platformFromName('audios'), undefined);
  });
});

describe('merging the base .env', () => {
  it('applies base values under the environment', () => {
    const merged = mergeEnvironment({ SHOW_LOGS: 'true', ENV: 'base' }, { ENV: 'staging' });
    assert.deepStrictEqual(merged, { SHOW_LOGS: 'true', ENV: 'staging' });
  });

  it('works with no base', () => {
    assert.deepStrictEqual(mergeEnvironment({}, { A: '1' }), { A: '1' });
  });

  it('works with no environment, leaving just the base', () => {
    assert.deepStrictEqual(mergeEnvironment({ A: '1' }, {}), { A: '1' });
  });
});
