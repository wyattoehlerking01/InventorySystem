const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createMockSupabaseClient({ failOnItemIds = [] } = {}) {
  const rows = [];
  const failureSet = new Set(failOnItemIds.map(String));

  const matchesFilter = (row, filters) => Object.entries(filters).every(([column, value]) => String(row[column]) === String(value));

  return {
    rows,
    from(table) {
      if (table !== 'project_items_out') {
        return {
          insert() {
            return { select: async () => ({ data: [], error: null }) };
          },
          delete() {
            return {
              eq() {
                return {
                  then(resolve) {
                    resolve({ error: null });
                  }
                };
              }
            };
          }
        };
      }

      return {
        insert(payloadRows) {
          return {
            select: async () => {
              const payload = payloadRows[0] || {};
              if (failureSet.has(String(payload.item_id))) {
                return {
                  data: null,
                  error: { code: 'PGRST_FAIL', message: `insert failed for ${payload.item_id}` }
                };
              }

              const insertedRows = payloadRows.map(payloadRow => ({ ...payloadRow }));
              rows.push(...insertedRows);
              return { data: insertedRows, error: null };
            }
          };
        },
        delete() {
          const filters = {};
          const builder = {
            eq(column, value) {
              filters[column] = value;
              return builder;
            },
            then(resolve) {
              for (let index = rows.length - 1; index >= 0; index -= 1) {
                if (matchesFilter(rows[index], filters)) {
                  rows.splice(index, 1);
                }
              }
              resolve({ error: null });
            }
          };
          return builder;
        }
      };
    }
  };
}

function loadDataContext({ withSupabase = false, supabaseKey = 'test-key', supabaseClient = null } = {}) {
  const dataJsPath = path.join(__dirname, '..', 'kiosk', 'data.js');
  const source = fs.readFileSync(dataJsPath, 'utf8');

  const context = {
    console,
    atob: (value) => Buffer.from(String(value), 'base64').toString('utf8'),
    crypto: {
      randomUUID: () => '123e4567-e89b-42d3-a456-426614174000'
    },
    window: {
      APP_ENV: withSupabase
        ? { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_KEY: supabaseKey }
        : {},
      supabase: withSupabase
        ? {
            createClient: () => supabaseClient || createMockSupabaseClient()
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

test('service-role Supabase key is rejected for browser client initialization', () => {
  const rolePayload = Buffer.from(JSON.stringify({ role: 'service_role' }))
    .toString('base64url');
  const fakeJwt = `a.${rolePayload}.c`;

  const context = loadDataContext({ withSupabase: true, supabaseKey: fakeJwt });

  assert.throws(
    () => context.requireSupabaseClient('unit-test'),
    /Supabase client unavailable/
  );
});

test('addProjectItemOutBatchToSupabase inserts all rows on success', async () => {
  const mockClient = createMockSupabaseClient();
  const context = loadDataContext({ withSupabase: true, supabaseClient: mockClient });

  const result = await context.addProjectItemOutBatchToSupabase([
    {
      id: 'out-1',
      projectId: 'project-a',
      itemId: 'item-a',
      quantity: 1,
      signoutDate: '2026-04-15T00:00:00.000Z',
      dueDate: '2026-04-15T01:00:00.000Z',
      assignedToUserId: 'student-1',
      signedOutByUserId: 'teacher-1'
    },
    {
      id: 'out-2',
      projectId: 'project-a',
      itemId: 'item-b',
      quantity: 2,
      signoutDate: '2026-04-15T00:00:00.000Z',
      dueDate: '2026-04-15T01:00:00.000Z',
      assignedToUserId: 'student-2',
      signedOutByUserId: 'teacher-1'
    }
  ]);

  assert.equal(result.length, 2);
  assert.equal(mockClient.rows.length, 2);
  assert.deepEqual(mockClient.rows.map(row => row.id), ['out-1', 'out-2']);
});

test('addProjectItemOutBatchToSupabase rolls back inserted rows on failure', async () => {
  const mockClient = createMockSupabaseClient({ failOnItemIds: ['item-b'] });
  const context = loadDataContext({ withSupabase: true, supabaseClient: mockClient });

  const result = await context.addProjectItemOutBatchToSupabase([
    {
      id: 'out-1',
      projectId: 'project-a',
      itemId: 'item-a',
      quantity: 1,
      signoutDate: '2026-04-15T00:00:00.000Z',
      dueDate: '2026-04-15T01:00:00.000Z',
      assignedToUserId: 'student-1',
      signedOutByUserId: 'teacher-1'
    },
    {
      id: 'out-2',
      projectId: 'project-a',
      itemId: 'item-b',
      quantity: 2,
      signoutDate: '2026-04-15T00:00:00.000Z',
      dueDate: '2026-04-15T01:00:00.000Z',
      assignedToUserId: 'student-2',
      signedOutByUserId: 'teacher-1'
    }
  ]);

  assert.equal(result, null);
  assert.equal(mockClient.rows.length, 0);
});
