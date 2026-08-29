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

test('sortAlphanumericNatural sorts numerically and alphabetically (0,1,2,3... A-Z)', () => {
  const context = loadDataContext({ withSupabase: false });
  const unsorted = ['Tag 10', 'Tag 2', 'Tag 1', 'Tag 0', 'Beta', 'Alpha', '0', '1', '2', '10', '20'];
  const sorted = context.sortAlphanumericNatural(unsorted);

  assert.deepEqual(sorted, [
    '0',
    '1',
    '2',
    '10',
    '20',
    'Alpha',
    'Beta',
    'Tag 0',
    'Tag 1',
    'Tag 2',
    'Tag 10'
  ]);
});

test('loadCategories and loadVisibilityTags sort rows naturally on load', async () => {
  const mockClient = {
    from(table) {
      if (table === 'categories') {
        return {
          select: async () => ({
            data: [
              { name: 'Woodworking' },
              { name: '3D Printing' },
              { name: '10mm Tools' },
              { name: '2mm Tools' },
              { name: '0 Setup' },
              { name: 'Electronics' }
            ],
            error: null
          })
        };
      }
      if (table === 'visibility_tags') {
        return {
          select: async () => ({
            data: [
              { name: 'Period 10' },
              { name: 'Period 2' },
              { name: 'Period 1' },
              { name: 'All Grades' },
              { name: '0-Intro' }
            ],
            error: null
          })
        };
      }
      return { select: async () => ({ data: [], error: null }) };
    }
  };

  const context = loadDataContext({ withSupabase: true, supabaseClient: mockClient });

  await context.loadCategories();
  const loadedCategories = vm.runInContext('categories', context);
  assert.deepEqual(loadedCategories, [
    '0 Setup',
    '2mm Tools',
    '3D Printing',
    '10mm Tools',
    'Electronics',
    'Woodworking'
  ]);

  await context.loadVisibilityTags();
  const loadedVisibilityTags = vm.runInContext('visibilityTags', context);
  assert.deepEqual(loadedVisibilityTags, [
    '0-Intro',
    'All Grades',
    'Period 1',
    'Period 2',
    'Period 10'
  ]);
});

test('renderItemVisibilityTagsHtml formats 1 tag as tag and >1 tags as summary button', () => {
  const manageAppSource = fs.readFileSync(path.join(__dirname, '..', 'manage', 'app.js'), 'utf8');
  assert.match(manageAppSource, /function renderItemVisibilityTagsHtml/);

  // Extract the function using regex or execute in a minimal sandbox
  const escapeHtml = str => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const sandbox = { escapeHtml };
  vm.createContext(sandbox);
  const fnCode = manageAppSource.match(/function renderItemVisibilityTagsHtml\(item\) \{[\s\S]*?\n\}/)[0];
  vm.runInContext(fnCode, sandbox);

  // 0 tags
  assert.equal(sandbox.renderItemVisibilityTagsHtml({ id: 'item-1', visibilityTags: [] }), '');

  // 1 tag
  const singleTagHtml = sandbox.renderItemVisibilityTagsHtml({ id: 'item-2', visibilityTags: ['Woodshop'] });
  assert.ok(singleTagHtml.includes('visibility-tag'));
  assert.ok(singleTagHtml.includes('Woodshop'));
  assert.ok(!singleTagHtml.includes('visibility-tag-summary-btn'));

  // Multiple tags (>1 tags)
  const multiTagHtml = sandbox.renderItemVisibilityTagsHtml({ id: 'item-3', visibilityTags: ['Woodshop', 'Laser', '3D Print'] });
  assert.ok(multiTagHtml.includes('visibility-tag-summary-btn'));
  assert.ok(multiTagHtml.includes('3 tags'));
  assert.ok(multiTagHtml.includes('data-id="item-3"'));
});


