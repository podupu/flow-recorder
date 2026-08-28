const assert = require('assert');
const {
  parseEnvironments,
  buildMaestroArgs,
  DEFAULT_ENVIRONMENTS_FILE,
  defaultEnvironmentsTemplate
} = require('../../out/environments');

describe('parsing maestro-env.json', () => {
  it('reads the shorthand form: name -> variables', () => {
    const { environments, errors } = parseEnvironments(
      JSON.stringify({
        environments: {
          staging: { BASE_URL: 'https://staging.example.com' },
          prod: { BASE_URL: 'https://example.com' }
        }
      })
    );
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(environments.map((e) => e.name), ['staging', 'prod']);
    assert.deepStrictEqual(environments[0].variables, { BASE_URL: 'https://staging.example.com' });
  });

  it('reads the long form with variables and tags', () => {
    const { environments, errors } = parseEnvironments(
      JSON.stringify({
        environments: {
          test: {
            variables: { BASE_URL: 'https://test.example.com' },
            includeTags: ['smoke'],
            excludeTags: ['slow']
          }
        }
      })
    );
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(environments[0].variables, { BASE_URL: 'https://test.example.com' });
    assert.deepStrictEqual(environments[0].includeTags, ['smoke']);
    assert.deepStrictEqual(environments[0].excludeTags, ['slow']);
  });

  it('coerces numbers and booleans to strings, since -e values are text', () => {
    const { environments } = parseEnvironments(
      JSON.stringify({ environments: { a: { TIMEOUT: 5000, DEBUG: true } } })
    );
    assert.deepStrictEqual(environments[0].variables, { TIMEOUT: '5000', DEBUG: 'true' });
  });

  it('rejects nested objects as values rather than stringifying them', () => {
    const { environments, errors } = parseEnvironments(
      JSON.stringify({ environments: { a: { NESTED: { x: 1 } } } })
    );
    assert.strictEqual(environments[0].variables.NESTED, undefined);
    assert.ok(errors.some((e) => e.includes('NESTED')), `expected an error naming NESTED, got ${errors}`);
  });

  it('reports malformed JSON instead of throwing', () => {
    const { environments, errors } = parseEnvironments('{ not json');
    assert.deepStrictEqual(environments, []);
    assert.strictEqual(errors.length, 1);
  });

  it('handles an empty or missing environments key', () => {
    assert.deepStrictEqual(parseEnvironments('{}').environments, []);
    assert.deepStrictEqual(parseEnvironments('').environments, []);
  });
});

describe('building the maestro command', () => {
  const env = { name: 'staging', variables: { BASE_URL: 'https://staging.example.com', USER: 'demo' } };

  it('passes each variable as its own -e flag', () => {
    const args = buildMaestroArgs(env, 'flows/login.flow.yaml');
    assert.deepStrictEqual(args, [
      'test',
      '-e',
      'BASE_URL=https://staging.example.com',
      '-e',
      'USER=demo',
      'flows/login.flow.yaml'
    ]);
  });

  it('omits -e entirely when the environment has no variables', () => {
    const args = buildMaestroArgs({ name: 'None', variables: {} }, 'a.flow.yaml');
    assert.deepStrictEqual(args, ['test', 'a.flow.yaml']);
  });

  it('works with no environment selected', () => {
    assert.deepStrictEqual(buildMaestroArgs(undefined, 'a.flow.yaml'), ['test', 'a.flow.yaml']);
  });

  it('includes tag filters when the environment defines them', () => {
    const args = buildMaestroArgs(
      { name: 't', variables: {}, includeTags: ['smoke', 'fast'], excludeTags: ['slow'] },
      'a.flow.yaml'
    );
    assert.ok(args.includes('--include-tags'));
    assert.ok(args.includes('smoke,fast'));
    assert.ok(args.includes('--exclude-tags'));
    assert.ok(args.includes('slow'));
  });

  it('keeps values with spaces as a single argument', () => {
    // Args are passed as an array, so no shell quoting is involved - but the pair must not split.
    const args = buildMaestroArgs({ name: 'x', variables: { GREETING: 'hello world' } }, 'a.flow.yaml');
    assert.ok(args.includes('GREETING=hello world'));
  });

  it('puts the flow path last so maestro treats it as the target', () => {
    const args = buildMaestroArgs(env, 'flows/login.flow.yaml');
    assert.strictEqual(args[args.length - 1], 'flows/login.flow.yaml');
  });
});

describe('the starter template', () => {
  it('names the file we look for', () => {
    assert.strictEqual(DEFAULT_ENVIRONMENTS_FILE, 'maestro-env.json');
  });

  it('produces a valid file that round-trips through the parser', () => {
    const { environments, errors } = parseEnvironments(defaultEnvironmentsTemplate());
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(environments.map((e) => e.name), ['staging', 'prod']);
  });

  it('only uses hostnames reserved for documentation', () => {
    // A plausible invented host (e.g. test.api.<real-domain>) fails at run time with an
    // obscure DNS error instead of an obvious "replace this". example.com is IANA-reserved.
    const template = defaultEnvironmentsTemplate();
    const hosts = [...template.matchAll(/https?:\/\/([^"\/]+)/g)].map((m) => m[1]);
    assert.ok(hosts.length > 0, 'template should contain example URLs');
    for (const host of hosts) {
      assert.ok(
        /(^|\.)example\.(com|org|net)$/.test(host) || /(^|\.)invalid$/.test(host),
        `${host} is not a reserved documentation hostname`
      );
    }
  });
});

describe('platform flag', () => {
  it('passes -p in the lowercase form the CLI expects', () => {
    // `maestro test -p <platform>`; the in-flow `when: platform:` condition uses Android/iOS.
    const args = buildMaestroArgs(undefined, 'a.flow.yaml', 'Android');
    assert.deepStrictEqual(args, ['test', '-p', 'android', 'a.flow.yaml']);
    assert.deepStrictEqual(buildMaestroArgs(undefined, 'a.flow.yaml', 'iOS'), [
      'test',
      '-p',
      'ios',
      'a.flow.yaml'
    ]);
  });

  it('omits -p when no platform is given', () => {
    assert.deepStrictEqual(buildMaestroArgs(undefined, 'a.flow.yaml'), ['test', 'a.flow.yaml']);
  });

  it('keeps the flow path last with every option present', () => {
    const args = buildMaestroArgs(
      { name: 'x', variables: { A: '1' }, includeTags: ['smoke'] },
      'a.flow.yaml',
      'Android'
    );
    assert.strictEqual(args[args.length - 1], 'a.flow.yaml');
    assert.ok(args.includes('-p') && args.includes('-e') && args.includes('--include-tags'));
  });
});

describe('$shared variables', () => {
  // Mirrors REST Client's `$shared`: values common to every environment, overridable.
  const file = JSON.stringify({
    environments: {
      $shared: { APP_ID: 'com.example.app', TIMEOUT: 5000 },
      staging: { BASE_URL: 'https://staging.example.com' },
      prod: { BASE_URL: 'https://example.com', TIMEOUT: 9000 }
    }
  });

  it('is not offered as a selectable environment', () => {
    const { environments } = parseEnvironments(file);
    assert.deepStrictEqual(environments.map((e) => e.name), ['staging', 'prod']);
  });

  it('merges shared values into every environment', () => {
    const { environments } = parseEnvironments(file);
    const staging = environments.find((e) => e.name === 'staging');
    assert.deepStrictEqual(staging.variables, {
      APP_ID: 'com.example.app',
      TIMEOUT: '5000',
      BASE_URL: 'https://staging.example.com'
    });
  });

  it('lets an environment override a shared value', () => {
    const { environments } = parseEnvironments(file);
    const prod = environments.find((e) => e.name === 'prod');
    assert.strictEqual(prod.variables.TIMEOUT, '9000');
    assert.strictEqual(prod.variables.APP_ID, 'com.example.app');
  });

  it('exposes shared separately so "None" can still use it', () => {
    const { shared } = parseEnvironments(file);
    assert.deepStrictEqual(shared, { APP_ID: 'com.example.app', TIMEOUT: '5000' });
  });

  it('is empty when no $shared block is present', () => {
    assert.deepStrictEqual(parseEnvironments('{"environments":{"a":{}}}').shared, {});
  });
});

describe('debug profile arguments', () => {
  it('retains debug artifacts in the given directory', () => {
    // Maestro has no debug protocol; "debug" means keeping screenshots/hierarchy/logs.
    const args = buildMaestroArgs(undefined, 'a.flow.yaml', 'Android', {
      debugOutput: '/tmp/out',
      flattenDebugOutput: true
    });
    assert.ok(args.includes('--debug-output'));
    assert.ok(args.includes('/tmp/out'));
    assert.ok(args.includes('--flatten-debug-output'));
    assert.strictEqual(args[args.length - 1], 'a.flow.yaml');
  });

  it('omits debug flags for a normal run', () => {
    const args = buildMaestroArgs(undefined, 'a.flow.yaml', 'Android');
    assert.ok(!args.includes('--debug-output'));
    assert.ok(!args.includes('--flatten-debug-output'));
  });

  it('does not add --flatten-debug-output without a directory', () => {
    const args = buildMaestroArgs(undefined, 'a.flow.yaml', undefined, { flattenDebugOutput: true });
    assert.ok(!args.includes('--flatten-debug-output'));
  });

  it('keeps env, platform and debug flags together with the path last', () => {
    const args = buildMaestroArgs(
      { name: 'x', variables: { A: '1' } },
      'flows/a.flow.yaml',
      'iOS',
      { debugOutput: '/tmp/d' }
    );
    assert.deepStrictEqual(args, [
      'test',
      '-p',
      'ios',
      '--debug-output',
      '/tmp/d',
      '-e',
      'A=1',
      'flows/a.flow.yaml'
    ]);
  });
});

describe('targeting a specific device', () => {
  it('passes --udid so maestro does not pick its own simulator', () => {
    // Observed: `maestro test -p ios` booted iPhone SE 15.5 instead of the mirrored device.
    const args = buildMaestroArgs(undefined, 'a.flow.yaml', 'iOS', { deviceId: 'ABC-123' });
    assert.deepStrictEqual(args, ['test', '-p', 'ios', '--udid', 'ABC-123', 'a.flow.yaml']);
  });

  it('omits --udid when no device is given', () => {
    assert.ok(!buildMaestroArgs(undefined, 'a.flow.yaml', 'iOS').includes('--udid'));
  });
});
