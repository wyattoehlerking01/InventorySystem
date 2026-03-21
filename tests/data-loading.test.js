const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDataContext({ withSupabase } = { withSupabase: false }) {
  const dataJsPath = path.join(__dirname, '..', 'data.js');
  const source = fs.readFileSync(dataJsPath, 'utf8');

  const context = {
    console,
    crypto: {
      randomUUID: () => '123e4567-e89b-42d3-a456-426614174000'
    },
    window: {
      APP_ENV: withSupabase
        ? { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: 'test-key' }
        : {},
      supabase: withSupabase
        ? {
            createClient: () => ({ from: () => ({ select: () => ({}) }) })
          }
        : undefined
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('requireSupabaseClient throws when client is unavailable', () => {
  const context = loadDataContext({ withSupabase: false });

  assert.throws(
    () => context.requireSupabaseClient('unit-test'),
    /Supabase client unavailable/
  );
});

test('requireSupabaseClient returns client when env and SDK are present', () => {
  const context = loadDataContext({ withSupabase: true });
  const client = context.requireSupabaseClient('unit-test');

  assert.ok(client);
  assert.equal(typeof client.from, 'function');
});

test('createUuid returns RFC4122-like UUID', () => {
  const context = loadDataContext({ withSupabase: false });
  const uuid = context.createUuid();

  assert.match(
    uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});
