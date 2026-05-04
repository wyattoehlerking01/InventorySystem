/* =======================================
   SUPABASE CLIENT & INITIALIZATION
   ======================================= */

// Initialize Supabase client
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_ENV || {};
const activeKioskId = String(window.APP_ENV?.KIOSK_ID ?? window.APP_ENV?.kioskId ?? '').trim();

function resolveLedTriggerUrl() {
    const explicitUrl = String(window.APP_ENV?.LED_TRIGGER_URL || '').trim();
    if (explicitUrl) return explicitUrl;

    const gpioUrl = String(window.APP_ENV?.GPIO_SERVER_URL || '').trim();
    if (!gpioUrl) return '';

    try {
        const parsed = new URL(gpioUrl);
        parsed.pathname = '/trigger';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return '';
    }
}

const LED_TRIGGER_URL = resolveLedTriggerUrl();

function notifySignoutLedTrigger() {
    if (!LED_TRIGGER_URL) return;
    if (typeof fetch !== 'function') {
        console.warn('LED trigger skipped: fetch is unavailable in this environment.');
        return;
    }

    // Fire-and-forget: this should never block checkout UX.
    Promise.resolve().then(() => {
        void fetch(LED_TRIGGER_URL, {
            method: 'GET',
            mode: 'no-cors',
            cache: 'no-store',
            keepalive: true
        }).catch(error => {
            console.warn('LED trigger request failed:', error);
        });
    });
}

function shouldTriggerLedForItem(itemOut) {
    const raw = itemOut?.requiresDoorUnlock ?? itemOut?.requires_door_unlock;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw === 1;
    if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }
    return false;
}

function decodeBase64Url(input) {
    const normalized = String(input || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(String(input || '').length / 4) * 4, '=');

    try {
        if (typeof atob === 'function') return atob(normalized);
    } catch (_) {
        // Fall through to Buffer path.
    }

    try {
        if (typeof Buffer !== 'undefined') return Buffer.from(normalized, 'base64').toString('utf8');
    } catch (_) {
        // Ignore decode failures.
    }

    return '';
}

function getSupabaseKeyRole(key) {
    const token = String(key || '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return '';

    try {
        const payloadRaw = decodeBase64Url(parts[1]);
        if (!payloadRaw) return '';
        const payload = JSON.parse(payloadRaw);
        return String(payload?.role || '').trim().toLowerCase();
    } catch (_) {
        return '';
    }
}

function isUnsafeClientSupabaseKey(key) {
    const role = getSupabaseKeyRole(key);
    return role === 'service_role' || role === 'supabase_admin';
}

let dbClient = null;
try {
    if (SUPABASE_URL && SUPABASE_KEY && window.supabase && typeof window.supabase.createClient === 'function') {
        if (isUnsafeClientSupabaseKey(SUPABASE_KEY)) {
            throw new Error('Unsafe Supabase key role detected for browser client. Use anon key only.');
        }

        dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
    }
} catch (e) {
    console.error('Supabase createClient failed:', e);
}

function requireSupabaseClient(context) {
    if (!dbClient) {
        throw new Error(`Supabase client unavailable during ${context}. Check env.js values and Supabase CDN loading.`);
    }
    return dbClient;
}

function createUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // RFC4122-ish fallback for environments without crypto.randomUUID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
async function loginWithBarcode(barcode) {
    try {
        const rawBarcode = String(barcode || '').trim();
        if (!rawBarcode) {
            return { error: 'Barcode is required' };
        }

        const lookupTokens = Array.from(new Set([
            rawBarcode,
            rawBarcode.toUpperCase()
        ]));

        let user = null;

        for (const token of lookupTokens) {
            user = await fetchUserByIdFromSupabase(token);
            if (user) break;
        }

        if (!user) {
            for (const token of lookupTokens) {
                user = await fetchUserByBarcodeFromSupabase(token);
                if (user) break;
            }
        }

        if (!user) {
            return { error: 'Invalid barcode scanned.' };
        }

        return {
            user,
            error: null
        };
    } catch (err) {
        console.error('loginWithBarcode failed:', err);
        return { error: 'Login failed' };
    }
}

async function fetchUserByBarcodeFromSupabase(barcodeValue) {
    const client = requireSupabaseClient('fetchUserByBarcodeFromSupabase');
    const normalizedBarcode = String(barcodeValue || '').trim();
    if (!normalizedBarcode) return null;

    const candidateColumns = [
        'barcode',
        'user_barcode',
        'card_barcode',
        'student_barcode',
        'scan_code',
        'badge_barcode'
    ];

    for (const columnName of candidateColumns) {
        const { data, error } = await client
            .from('users')
            .select('*')
            .eq(columnName, normalizedBarcode)
            .maybeSingle();

        if (!error && data) return data;
        if (!error) continue;

        const errorCode = String(error.code || '').trim();
        const message = String(error.message || '').toLowerCase();
        const missingColumnError = errorCode === '42703'
            || (message.includes('column') && message.includes('does not exist'));

        if (!missingColumnError) {
            console.warn(`Barcode lookup failed for users.${columnName}:`, error);
        }
    }

    return null;
}

function normalizeUserNameToken(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeIdentityToken(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function hashAuthPasswordValue(passwordValue) {
    const value = String(passwordValue || '').trim();
    if (!value) return '';

    try {
        if (window.crypto?.subtle && typeof TextEncoder !== 'undefined') {
            const bytes = new TextEncoder().encode(value);
            const digest = await window.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch {
        // Fall through to deterministic fallback.
    }

    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
}

function getStoredAuthPasswordHash(user) {
    if (!user) return '';
    return String(
        user.privileged_password_hash
        || user.privileged_auth_password_hash
        || user.auth_password_hash
        || user.authentication_password_hash
        || user.password_hash
        || user.staff_password_hash
        || ''
    ).trim();
}

function getAuthPasswordCandidates(user) {
    if (!user) return [];

    const fields = [
        user.privileged_password_hash,
        user.privileged_auth_password_hash,
        user.staff_password_hash,
        user.auth_password_hash,
        user.authentication_password_hash,
        user.password_hash,
        user.auth_password,
        user.authentication_password,
        user.password
    ];

    return fields
        .map(value => String(value || '').trim())
        .filter(Boolean);
}

function looksLikeSha256Hex(value) {
    return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

async function doesPasswordMatchUser(user, enteredPassword) {
    const candidates = getAuthPasswordCandidates(user);
    if (candidates.length === 0) {
        return { matched: false, configured: false };
    }

    const rawPassword = String(enteredPassword || '').trim();
    if (!rawPassword) {
        return { matched: false, configured: true };
    }

    const hashedPassword = await hashAuthPasswordValue(rawPassword);
    const hashedLower = String(hashedPassword || '').toLowerCase();
    const rawLower = rawPassword.toLowerCase();

    for (const storedValue of candidates) {
        const normalizedStored = storedValue.toLowerCase();

        // Preferred secure path: SHA-256 hash compare.
        if (looksLikeSha256Hex(storedValue) && normalizedStored === hashedLower) {
            return { matched: true, configured: true };
        }

        // Compatibility path for legacy environments where plaintext was stored.
        if (!looksLikeSha256Hex(storedValue) && normalizedStored === rawLower) {
            return { matched: true, configured: true };
        }
    }

    return { matched: false, configured: true };
}

function findUserByIdentityLocal(identity) {
    const normalizedIdentity = normalizeIdentityToken(identity);
    if (!normalizedIdentity) return null;

    return (mockUsers || []).find(user => {
        const tokens = [
            normalizeIdentityToken(user?.name),
            normalizeIdentityToken(user?.id),
            normalizeIdentityToken(user?.email),
            normalizeIdentityToken(user?.username)
        ].filter(Boolean);
        return tokens.includes(normalizedIdentity);
    }) || null;
}

async function fetchUserByIdentityFromSupabase(identity) {
    const client = requireSupabaseClient('fetchUserByIdentityFromSupabase');
    const rawIdentity = String(identity || '').trim();
    const normalizedIdentity = normalizeIdentityToken(rawIdentity);
    if (!normalizedIdentity) return null;

    const queryPlans = [
        { column: 'name', op: 'eq', value: rawIdentity },
        { column: 'id', op: 'eq', value: rawIdentity },
        { column: 'email', op: 'eq', value: rawIdentity },
        { column: 'username', op: 'eq', value: rawIdentity },
        { column: 'name', op: 'ilike', value: rawIdentity },
        { column: 'email', op: 'ilike', value: rawIdentity },
        { column: 'username', op: 'ilike', value: rawIdentity }
    ];

    for (const plan of queryPlans) {
        const builder = client.from('users').select('*');
        const result = plan.op === 'ilike'
            ? await builder.ilike(plan.column, plan.value)
            : await builder.eq(plan.column, plan.value);

        if (result.error) {
            const errorCode = String(result.error.code || '').trim();
            const message = String(result.error.message || '').toLowerCase();
            const missingColumnError = errorCode === '42703'
                || (message.includes('column') && message.includes('does not exist'));
            if (!missingColumnError) {
                console.warn(`Identity lookup failed for users.${plan.column}:`, result.error);
            }
            continue;
        }

        const matched = (result.data || []).find(user => {
            const tokens = [
                normalizeIdentityToken(user?.name),
                normalizeIdentityToken(user?.id),
                normalizeIdentityToken(user?.email),
                normalizeIdentityToken(user?.username)
            ].filter(Boolean);
            return tokens.includes(normalizedIdentity);
        });

        if (matched) return matched;
    }

    return null;
}

async function loginWithUsernameAndPassword(username, password) {
    try {
        const normalizedUsername = String(username || '').trim();
        const normalizedPassword = String(password || '').trim();

        if (!normalizedUsername || !normalizedPassword) {
            return { error: 'Username and password are required.' };
        }

        let user = await fetchUserByIdentityFromSupabase(normalizedUsername);
        if (!user) {
            user = findUserByIdentityLocal(normalizedUsername);
        }
        if (!user) {
            return { error: 'Invalid username or password.' };
        }

        const expectedHash = getStoredAuthPasswordHash(user);
        if (!expectedHash && getAuthPasswordCandidates(user).length === 0) {
            return { error: 'Authentication password is not configured for this account.' };
        }

        const matchResult = await doesPasswordMatchUser(user, normalizedPassword);
        if (!matchResult.configured) {
            return { error: 'Authentication password is not configured for this account.' };
        }

        if (!matchResult.matched) {
            return { error: 'Invalid username or password.' };
        }

        return {
            user,
            error: null
        };
    } catch (err) {
        console.error('loginWithUsernameAndPassword failed:', err);
        return { error: 'Login failed' };
    }
}

/**
 * Save authentication password hash to Supabase for a user
 * Stores as auth_password_hash and updates in-memory user
 */
async function saveAuthPasswordToSupabase(userId, password) {
    if (!userId || !password) return false;

    try {
        const hashedPassword = await hashAuthPasswordValue(password);
        if (!hashedPassword) return false;

        const { data, error } = await dbClient
            .from('users')
            .update({ auth_password_hash: hashedPassword })
            .eq('id', userId)
            .select();

        if (error) {
            console.error('Error saving auth password to Supabase:', error);
            return false;
        }

        // Update in-memory user data
        const userIndex = mockUsers.findIndex(u => u.id === userId);
        if (userIndex !== -1) {
            mockUsers[userIndex] = { ...mockUsers[userIndex], auth_password_hash: hashedPassword };
        }

        return true;
    } catch (err) {
        console.error('Failed to save auth password:', err);
        return false;
    }
}

/* =======================================
   GLOBAL DATA ARRAYS (from Supabase)
   ======================================= */

let inventoryItems = [];
let mockUsers = [];
let projects = [];
let studentClasses = [];
let categories = [];
let visibilityTags = [];
let activityLogs = [];
let doorSensorEvents = [];
let helpRequests = [];
let extensionRequests = [];
let orderRequests = [];
let systemFlags = [];
let lastProjectItemOutError = '';

function getLastProjectItemOutError() {
    return String(lastProjectItemOutError || '').trim();
}

/* =======================================
   DATA LOADING FUNCTIONS
   ======================================= */

/**
 * Load all data from Supabase tables
 */
async function loadAllData() {
    requireSupabaseClient('loadAllData');

    try {
        await Promise.all([
            loadUsers(),
            loadInventoryItems(),
            loadProjects(),
            loadCategories(),
            loadVisibilityTags(),
            loadDoorSensorEvents(),
            loadActivityLogs(),
            loadHelpRequests(),
            loadExtensionRequests(),
            loadOrderRequests(),
            loadSystemFlags(),
            loadProjectCollaborators(),
            loadProjectItemsOut(),
            loadInventoryItemVisibility(),
            loadStudentClasses()
        ]);
        console.log('All data loaded from Supabase successfully.');
    } catch (error) {
        console.error('Error loading data from Supabase:', error);
        throw error;
    }
}

/**
 * Load users from public.users table
 */
async function loadUsers() {
    const isSchemaEntityError = (err) => {
        const message = String(err?.message || '').toLowerCase();
        const code = String(err?.code || '').toUpperCase();
        return message.includes('does not exist')
            || message.includes('schema cache')
            || message.includes('could not find')
            || code === '42703'
            || code === '42P01'
            || code === 'PGRST204';
    };

    const normalizePerms = (value, role = 'student') => {
        if (role !== 'student') {
            return {
                canCreateProjects: true,
                canJoinProjects: true,
                canSignOut: true
            };
        }

        const source = value || {};
        return {
            canCreateProjects: !!source.canCreateProjects,
            canJoinProjects: source.canJoinProjects ?? true,
            canSignOut: !!source.canSignOut
        };
    };

    const { data, error } = await dbClient.from('users').select('*');
    if (error) {
        console.error('Error loading users:', error);
        return;
    }

    let permissionsByUserId = {};
    const { data: userPermissionsData, error: userPermissionsError } = await dbClient
        .from('user_permissions')
        .select('user_id, can_create_projects, can_join_projects, can_sign_out');

    if (userPermissionsError && !isSchemaEntityError(userPermissionsError)) {
        console.error('Error loading user_permissions:', userPermissionsError);
    }

    if (!userPermissionsError && Array.isArray(userPermissionsData)) {
        permissionsByUserId = userPermissionsData.reduce((acc, row) => {
            acc[row.user_id] = {
                canCreateProjects: !!row.can_create_projects,
                canJoinProjects: !!row.can_join_projects,
                canSignOut: !!row.can_sign_out
            };
            return acc;
        }, {});
    }

    mockUsers = (data || []).map(user => {
        const role = String(user?.role || '').toLowerCase();
        const permsFromJson = (user?.perms && typeof user.perms === 'object') ? user.perms : null;
        const permsFromColumns = (
            Object.prototype.hasOwnProperty.call(user || {}, 'can_create_projects')
            || Object.prototype.hasOwnProperty.call(user || {}, 'can_join_projects')
            || Object.prototype.hasOwnProperty.call(user || {}, 'can_sign_out')
        ) ? {
            canCreateProjects: !!user.can_create_projects,
            canJoinProjects: !!user.can_join_projects,
            canSignOut: !!user.can_sign_out
        } : null;

        const permsFromTable = permissionsByUserId[user.id] || null;
        const normalizedPerms = normalizePerms(permsFromJson || permsFromColumns || permsFromTable, role || 'student');

        return {
            ...user,
            perms: normalizedPerms
        };
    });
    console.log(`Loaded ${mockUsers.length} users`);
}

/**
 * Reload users from Supabase and return current in-memory array
 */
async function refreshUsersFromSupabase() {
    await loadUsers();
    return mockUsers;
}

/**
 * Fetch one user by ID directly from Supabase (login source of truth)
 */
async function fetchUserByIdFromSupabase(userId) {
    const client = requireSupabaseClient('fetchUserByIdFromSupabase');

    const { data, error } = await client
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching user by id:', error);
        throw error;
    }

    return data || null;
}

/**
 * Load inventory items from public.inventory_items table
 */
async function loadInventoryItems() {
    const { data, error } = await dbClient.from('inventory_items').select('*');
    if (error) {
        console.error('Error loading inventory items:', error);
        return;
    }
    inventoryItems = (data || []).map(row => ({
        ...row,
        storageLocation: row.storageLocation ?? row.storage_location ?? row.location ?? null,
        imageLink: row.imageLink ?? row.image_link ?? null,
        supplierListingLink: row.supplierListingLink ?? row.supplier_listing_link ?? null,
        requiresDoorUnlock: row.requiresDoorUnlock ?? row.requires_door_unlock ?? true
    }));
    console.log(`Loaded ${inventoryItems.length} inventory items`);
}

/**
 * Reload inventory items and visibility tags from Supabase
 */
async function refreshInventoryFromSupabase() {
    await loadInventoryItems();
    await loadInventoryItemVisibility();
    return inventoryItems;
}

/**
 * Load projects from public.projects table
 */
async function loadProjects() {
    const { data, error } = await dbClient.from('projects').select('*');
    if (error) {
        console.error('Error loading projects:', error);
        return;
    }
    projects = data.map(proj => ({
        ...proj,
        collaborators: [],
        itemsOut: [],
        ownerId: proj.owner_id,
        classId: proj.class_id ?? proj.classId ?? null,
        description: proj.description || '',
        name: proj.name || ''
    })) || [];
    console.log(`Loaded ${projects.length} projects`);
}

/**
 * Load categories from public.categories table
 */
async function loadCategories() {
    const { data, error } = await dbClient.from('categories').select('name');
    if (error) {
        console.error('Error loading categories:', error);
        return;
    }
    categories = (data || []).map(c => c.name);
    console.log(`Loaded ${categories.length} categories`);
}

/**
 * Load visibility tags from public.visibility_tags table
 */
async function loadVisibilityTags() {
    const { data, error } = await dbClient.from('visibility_tags').select('name');
    if (error) {
        console.error('Error loading visibility tags:', error);
        return;
    }
    visibilityTags = (data || []).map(t => t.name);
    console.log(`Loaded ${visibilityTags.length} visibility tags`);
}

/**
 * Load activity logs from public.activity_logs table
 */
async function loadActivityLogs() {
    const { data, error } = await dbClient.from('activity_logs').select('*').order('timestamp', { ascending: false });
    if (error) {
        console.error('Error loading activity logs:', error);
        return;
    }
    activityLogs = data || [];

    // Fold door sensor telemetry into the activity log so operators can review
    // door state changes alongside the rest of the system history.
    try {
        const doorEventsQuery = dbClient
            .from('door_sensor_events')
            .select('id, kiosk_id, sensor_id, local_seq, event_type, event_ts, source, unlock_job_id, actor_user_id, metadata, created_at')
            .order('event_ts', { ascending: false })
            .order('local_seq', { ascending: false })
            .limit(100);

        const doorEventsResult = kioskId
            ? await doorEventsQuery.eq('kiosk_id', kioskId)
            : await doorEventsQuery;

        if (doorEventsResult.error) {
            console.warn('Error loading door sensor events:', doorEventsResult.error);
        } else if (Array.isArray(doorEventsResult.data) && doorEventsResult.data.length > 0) {
            const doorSensorActivities = doorEventsResult.data
                .map(mapDoorSensorEventToActivityLog)
                .filter(Boolean);

            activityLogs = (activityLogs || []).concat(doorSensorActivities);
        }
    } catch (err) {
        console.warn('Failed to load door sensor activity:', err);
    }

    // Also load recent door open sessions and merge into activity logs for visibility
    try {
        const { data: doorSessions, error: dsErr } = await dbClient
            .from('door_open_sessions')
            .select('*')
            .eq('kiosk_id', kioskId)
            .order('closed_at', { ascending: false })
            .limit(50);

        if (dsErr) {
            console.warn('Error loading door open sessions:', dsErr);
        } else if (Array.isArray(doorSessions) && doorSessions.length > 0) {
            const doorActivities = doorSessions.map(s => {
                const openedAt = s.opened_at ? new Date(s.opened_at) : null;
                const closedAt = s.closed_at ? new Date(s.closed_at) : null;
                const durMs = Number(s.duration_ms || 0);
                const durSec = Math.max(0, Math.floor(durMs / 1000));
                const durText = (() => {
                    if (durSec < 60) return `${durSec}s`;
                    const mins = Math.floor(durSec / 60);
                    const secs = durSec % 60;
                    return `${mins}m ${secs}s`;
                })();
                const actor = s.actor_user_id || s.actorUserId || 'SYSTEM';
                const openedText = openedAt ? openedAt.toLocaleString() : 'Unknown';
                const closedText = closedAt ? closedAt.toLocaleString() : 'Open';

                return {
                    id: `door_session:${s.id}`,
                    user_id: actor,
                    action: `Door opened at ${openedText} by ${actor}. Closed at ${closedText} — open for ${durText}.`,
                    timestamp: s.closed_at || s.opened_at || s.created_at
                };
            });

            activityLogs = (activityLogs || []).concat(doorActivities);
        }
    } catch (err) {
        console.warn('Failed to load door session activity:', err);
    }

    // Normalize and sort by timestamp desc
    activityLogs = (activityLogs || []).map(row => ({
        ...row,
        timestamp: row.timestamp || row.created_at || row.ts || null
    })).sort((a, b) => {
        const ta = Date.parse(String(a.timestamp || '')) || 0;
        const tb = Date.parse(String(b.timestamp || '')) || 0;
        return tb - ta;
    });

    console.log(`Loaded ${activityLogs.length} activity logs (including door sessions)`);
}

function normalizeDoorSensorEventRecord(row) {
    if (!row) return null;

    const eventType = String(row.event_type || '').trim().toLowerCase();
    if (!eventType) return null;

    return {
        id: String(row.id || row.local_seq || createUuid()),
        kiosk_id: String(row.kiosk_id || activeKioskId || '').trim(),
        sensor_id: String(row.sensor_id || 'door-1').trim() || 'door-1',
        local_seq: Number(row.local_seq || 0),
        event_type: eventType,
        event_ts: row.event_ts || row.created_at || null,
        source: String(row.source || 'pi-agent').trim() || 'pi-agent',
        unlock_job_id: row.unlock_job_id || null,
        actor_user_id: String(row.actor_user_id || '').trim() || null,
        metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
        created_at: row.created_at || row.event_ts || null
    };
}

/**
 * Load door sensor event rows from public.door_sensor_events table
 */
async function loadDoorSensorEvents() {
    const isSchemaEntityError = (err) => {
        const message = String(err?.message || '').toLowerCase();
        const code = String(err?.code || '').toUpperCase();
        return message.includes('does not exist')
            || message.includes('schema cache')
            || message.includes('could not find')
            || code === '42703'
            || code === '42P01'
            || code === 'PGRST204';
    };

    let query = dbClient
        .from('door_sensor_events')
        .select('id, kiosk_id, sensor_id, local_seq, event_type, event_ts, source, unlock_job_id, actor_user_id, metadata, created_at')
        .in('event_type', ['open', 'close'])
        .order('event_ts', { ascending: false })
        .order('local_seq', { ascending: false });

    if (activeKioskId) {
        query = query.eq('kiosk_id', activeKioskId);
    }

    const { data, error } = await query;
    if (error) {
        if (isSchemaEntityError(error)) {
            console.warn('door_sensor_events table is unavailable yet.');
            doorSensorEvents = [];
            return;
        }

        console.error('Error loading door sensor events:', error);
        return;
    }

    doorSensorEvents = (data || [])
        .map(normalizeDoorSensorEventRecord)
        .filter(Boolean)
        .sort((a, b) => {
            const ta = Date.parse(String(a.event_ts || a.created_at || '')) || 0;
            const tb = Date.parse(String(b.event_ts || b.created_at || '')) || 0;
            if (tb !== ta) return tb - ta;
            return Number(b.local_seq || 0) - Number(a.local_seq || 0);
        });

    console.log(`Loaded ${doorSensorEvents.length} door sensor events`);
}

function mapDoorSensorEventToActivityLog(row) {
    if (!row) return null;

    const eventType = String(row.event_type || '').trim().toLowerCase();
    const sensorId = String(row.sensor_id || 'door-1').trim() || 'door-1';
    const actorId = String(row.actor_user_id || 'SYSTEM').trim() || 'SYSTEM';
    const eventTimestamp = row.event_ts || row.created_at || null;
    const source = String(row.source || '').trim();
    const unlockJobId = String(row.unlock_job_id || '').trim();
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : null;

    const actionLabels = {
        open: 'Door Sensor Open',
        close: 'Door Sensor Close',
        heartbeat: 'Door Sensor Heartbeat',
        fault: 'Door Sensor Fault'
    };

    const action = actionLabels[eventType] || `Door Sensor ${eventType || 'Event'}`;
    const details = [
        `Sensor ${sensorId}`,
        eventType ? `Event ${eventType}` : null,
        source ? `Source ${source}` : null,
        unlockJobId ? `Unlock Job ${unlockJobId}` : null,
        metadata && Object.keys(metadata).length > 0 ? `Metadata ${JSON.stringify(metadata)}` : null
    ].filter(Boolean).join(' • ');

    return {
        id: `door_sensor_event:${String(row.id || row.local_seq || eventTimestamp || createUuid())}`,
        user_id: actorId,
        action,
        details,
        timestamp: eventTimestamp,
        sourceTable: 'door_sensor_events'
    };
}

function appendDoorSensorActivityLog(row) {
    const activityLog = mapDoorSensorEventToActivityLog(row);
    if (!activityLog) return;

    const existingId = String(activityLog.id || '');
    if (!existingId) return;
    if ((activityLogs || []).some(log => String(log.id || '') === existingId)) return;

    activityLogs = [activityLog, ...(activityLogs || [])].sort((a, b) => {
        const ta = Date.parse(String(a.timestamp || '')) || 0;
        const tb = Date.parse(String(b.timestamp || '')) || 0;
        return tb - ta;
    });

    try {
        renderLogs();
    } catch {
        // Ignore render timing races during realtime updates.
    }
}

function appendDoorSensorEventRecord(row) {
    const eventRecord = normalizeDoorSensorEventRecord(row);
    if (!eventRecord) return;

    const existingId = String(eventRecord.id || '').trim();
    if (!existingId) return;
    if ((doorSensorEvents || []).some(event => String(event.id || '') === existingId)) return;

    doorSensorEvents = [eventRecord, ...(doorSensorEvents || [])].sort((a, b) => {
        const ta = Date.parse(String(a.event_ts || a.created_at || '')) || 0;
        const tb = Date.parse(String(b.event_ts || b.created_at || '')) || 0;
        if (tb !== ta) return tb - ta;
        return Number(b.local_seq || 0) - Number(a.local_seq || 0);
    });

    try {
        renderDoorPage();
    } catch {
        // Ignore render timing races during realtime updates.
    }
}

/**
 * Load help requests from public.help_requests table
 */
async function loadHelpRequests() {
    const { data, error } = await dbClient.from('help_requests').select('*').order('timestamp', { ascending: false });
    if (error) {
        console.error('Error loading help requests:', error);
        return;
    }
    helpRequests = data || [];
    console.log(`Loaded ${helpRequests.length} help requests`);
}

/**
 * Load extension requests from public.extension_requests table
 */
async function loadExtensionRequests() {
    const { data, error } = await dbClient.from('extension_requests').select('*').order('timestamp', { ascending: false });
    if (error) {
        console.error('Error loading extension requests:', error);
        return;
    }
    extensionRequests = (data || []).map(row => ({
        id: row.id,
        userId: row.user_id ?? row.userId,
        userName: row.user_name ?? row.userName ?? row.name,
        itemId: row.item_id ?? row.itemId,
        itemName: row.item_name ?? row.itemName,
        projectName: row.project_name ?? row.projectName,
        currentDue: row.current_due ?? row.currentDue,
        requestedDue: row.requested_due ?? row.requestedDue,
        status: row.status,
        timestamp: row.timestamp
    }));
    console.log(`Loaded ${extensionRequests.length} extension requests`);
}

/**
 * Add a student message (teacher -> student)
 */
async function addStudentMessage(payload) {
    if (!payload || !payload.sender_id) return { error: 'invalid_payload' };
    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `student_messages:${String(payload.target_user_id || 'local')}`;
            const existing = JSON.parse(localStorage.getItem(key) || '[]');
            existing.unshift({ ...payload, id: generateId('MSG'), created_at: new Date().toISOString(), read_at: null });
            localStorage.setItem(key, JSON.stringify(existing));
            return { data: payload };
        } catch (e) {
            console.error('addStudentMessage local fallback failed', e);
            return { error: e };
        }
    }

    try {
        const { data, error } = await dbClient.from('student_messages').insert([{ ...payload, read_at: null }]).select();
        if (error) return { error };
        return { data };
    } catch (err) {
        console.error('addStudentMessage failed', err);
        return { error: err };
    }
}

/**
 * Reset onboarding state for a given user (teacher action)
 */
async function resetOnboardingForUser(userId) {
    if (!userId) return false;
    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `onboarding_state:${userId}`;
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn('resetOnboardingForUser fallback failed', e);
            return false;
        }
    }

    try {
        const { data, error } = await dbClient.from('onboarding_state').upsert({ user_id: userId, completed: false, completed_at: null }).select();
        if (error) {
            // Try delete then insert
            await dbClient.from('onboarding_state').delete().eq('user_id', userId);
            await dbClient.from('onboarding_state').insert([{ user_id: userId, completed: false }]);
        }
        return true;
    } catch (err) {
        console.warn('resetOnboardingForUser failed', err);
        return false;
    }
}

/**
 * Load order requests from public.order_requests table
 */
async function loadOrderRequests() {
    const { data, error } = await dbClient.from('order_requests').select('*').order('timestamp', { ascending: false });
    if (error) {
        console.error('Error loading order requests:', error);
        orderRequests = [];
        return;
    }

    orderRequests = (data || []).map(row => ({
        id: row.id,
        requestedByUserId: row.requested_by_user_id ?? row.requestedByUserId,
        requestedByName: row.requested_by_name ?? row.requestedByName,
        itemName: row.item_name ?? row.itemName,
        category: row.category || 'Uncategorized',
        quantity: row.quantity || 1,
        justification: row.justification || '',
        status: row.status || 'Pending',
        timestamp: row.timestamp
    }));

    console.log(`Loaded ${orderRequests.length} order requests`);
}

/**
 * Load system flags from public.system_flags table.
 * If table is not present yet, fail gracefully with an empty list.
 */
async function loadSystemFlags() {
    const { data, error } = await dbClient.from('system_flags').select('*').order('created_at', { ascending: false });
    if (error) {
        console.warn('system_flags unavailable (run migration to enable):', error.message || error);
        systemFlags = [];
        return;
    }

    systemFlags = data || [];
    console.log(`Loaded ${systemFlags.length} system flags`);
}

/**
 * Reload projects and dependent relations from Supabase
 */
async function refreshProjectsFromSupabase() {
    await loadProjects();
    await Promise.all([
        loadProjectCollaborators(),
        loadProjectItemsOut()
    ]);
    return projects;
}

/**
 * Reload request collections from Supabase
 */
async function refreshRequestsFromSupabase() {
    await Promise.all([
        loadHelpRequests(),
        loadExtensionRequests(),
        loadOrderRequests(),
        loadSystemFlags()
    ]);
}

/**
 * Load project collaborators and attach to projects
 */
async function loadProjectCollaborators() {
    const { data, error } = await dbClient.from('project_collaborators').select('project_id, user_id');
    if (error) {
        console.error('Error loading project collaborators:', error);
        return;
    }
    
    data.forEach(collab => {
        const project = projects.find(p => p.id === collab.project_id);
        if (project && !project.collaborators.includes(collab.user_id)) {
            project.collaborators.push(collab.user_id);
        }
    });
}

/**
 * Load project items out and attach to projects
 */
async function loadProjectItemsOut() {
    const { data, error } = await dbClient.from('project_items_out').select('*');
    if (error) {
        console.error('Error loading project items out:', error);
        return;
    }
    
    data.forEach(io => {
        const project = projects.find(p => p.id === io.project_id);
        if (project) {
            project.itemsOut.push({
                id: io.id,
                itemId: io.item_id,
                quantity: io.quantity,
                signoutDate: io.signout_date,
                dueDate: io.due_date,
                assignedToUserId: io.assigned_to_user_id ?? io.assignedToUserId ?? null,
                signedOutByUserId: io.signed_out_by_user_id ?? io.signedOutByUserId ?? null
            });
        }
    });
}

/**
 * Load inventory item visibility tags
 */
async function loadInventoryItemVisibility() {
    const { data, error } = await dbClient.from('inventory_item_visibility').select('item_id, tag_id');
    if (error) {
        console.error('Error loading item visibility tags:', error);
        return;
    }

    const { data: tagRows, error: tagError } = await dbClient.from('visibility_tags').select('id, name');
    if (tagError) {
        console.error('Error loading visibility tag map:', tagError);
        return;
    }

    const tagMap = {};
    (tagRows || []).forEach(tagRow => {
        tagMap[tagRow.id] = tagRow.name;
    });
    
    data.forEach(iv => {
        const item = inventoryItems.find(i => i.id === iv.item_id);
        if (item) {
            if (!item.visibilityTags) item.visibilityTags = [];
            if (tagMap[iv.tag_id]) {
                item.visibilityTags.push(tagMap[iv.tag_id]);
            }
        }
    });
}

/**
 * Load student classes from class-related tables
 */
async function loadStudentClasses() {
    const parseMinutes = (timeString) => {
        const [hours, minutes] = String(timeString || '').split(':').map(Number);
        if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
        return (hours * 60) + minutes;
    };

    const isSchemaColumnError = (error) => {
        const msg = String(error?.message || '').toLowerCase();
        return /column .* does not exist/i.test(String(error?.message || ''))
            || msg.includes('could not find the')
            || msg.includes('schema cache')
            || msg.includes('undefined_column');
    };

    const [
        classesRes,
        studentsRes,
        visibleItemsRes,
        classTagsRes,
        duePolicyRes,
        duePeriodsRes,
        permissionsRes
    ] = await Promise.all([
        dbClient.from('student_classes').select('id, name, teacher_id'),
        dbClient.from('class_students').select('class_id, student_id'),
        dbClient.from('class_visible_items').select('class_id, item_id'),
        dbClient.from('class_visibility_tags').select('class_id, visibility_tags(name)'),
        dbClient.from('class_due_policy').select('class_id, default_signout_minutes, class_period_minutes, timezone'),
        dbClient.from('class_due_policy_periods').select('class_id, start_time, end_time, return_class_periods, due_mode, due_minutes_before_end, due_at_time'),
        dbClient.from('class_permissions').select('class_id, can_create_projects, can_join_projects, can_sign_out, auto_trigger_attention_on_sign_in')
    ]);

    let permissionsData = permissionsRes.data || [];
    let permissionsError = permissionsRes.error;
    if (permissionsError && isSchemaColumnError(permissionsError)) {
        const fallbackPermissionsRes = await dbClient
            .from('class_permissions')
            .select('class_id, can_create_projects, can_join_projects, can_sign_out');
        if (!fallbackPermissionsRes.error) {
            permissionsData = fallbackPermissionsRes.data || [];
            permissionsError = null;
        }
    }

    let duePeriodsData = duePeriodsRes.data || [];
    let duePeriodsError = duePeriodsRes.error;
    if (duePeriodsError && isSchemaColumnError(duePeriodsError)) {
        const fallbackRes = await dbClient
            .from('class_due_policy_periods')
            .select('class_id, start_time, end_time, return_class_periods, due_mode, due_minutes_before_end');
        if (!fallbackRes.error) {
            duePeriodsData = fallbackRes.data || [];
            duePeriodsError = null;
        }
    }

    const errors = [
        classesRes.error,
        studentsRes.error,
        visibleItemsRes.error,
        classTagsRes.error,
        duePolicyRes.error,
        duePeriodsError,
        permissionsError
    ].filter(Boolean);

    if (errors.length > 0) {
        console.error('Error loading student classes:', errors[0]);
        studentClasses = [];
        return;
    }

    const studentsByClass = {};
    (studentsRes.data || []).forEach(row => {
        if (!studentsByClass[row.class_id]) studentsByClass[row.class_id] = [];
        studentsByClass[row.class_id].push(row.student_id);
    });

    const itemsByClass = {};
    (visibleItemsRes.data || []).forEach(row => {
        if (!itemsByClass[row.class_id]) itemsByClass[row.class_id] = [];
        itemsByClass[row.class_id].push(row.item_id);
    });

    const tagsByClass = {};
    (classTagsRes.data || []).forEach(row => {
        if (!tagsByClass[row.class_id]) tagsByClass[row.class_id] = [];
        const tagName = row.visibility_tags?.name || row.visibility_tags?.[0]?.name;
        if (tagName) tagsByClass[row.class_id].push(tagName);
    });

    const duePolicyByClass = {};
    (duePolicyRes.data || []).forEach(row => {
        duePolicyByClass[row.class_id] = {
            defaultSignoutMinutes: row.default_signout_minutes,
            timezone: row.timezone,
            periodRanges: []
        };
    });

    (duePeriodsData || []).forEach(row => {
        if (!duePolicyByClass[row.class_id]) {
            duePolicyByClass[row.class_id] = {
                defaultSignoutMinutes: 80,
                timezone: 'America/Edmonton',
                periodRanges: []
            };
        }

        const start = String(row.start_time).slice(0, 5);
        const end = String(row.end_time).slice(0, 5);
        const startMinutes = parseMinutes(start);
        const endMinutes = parseMinutes(end);

        let resolvedDueAt = row.due_at_time ? String(row.due_at_time).slice(0, 5) : '';
        if (!resolvedDueAt && startMinutes !== null && endMinutes !== null) {
            if (row.due_mode === 'minutes_before_end') {
                const minutesBefore = Math.max(0, parseInt(row.due_minutes_before_end, 10) || 0);
                const target = Math.max(startMinutes, endMinutes - minutesBefore);
                const hh = String(Math.floor(target / 60)).padStart(2, '0');
                const mm = String(target % 60).padStart(2, '0');
                resolvedDueAt = `${hh}:${mm}`;
            } else {
                resolvedDueAt = end;
            }
        }

        duePolicyByClass[row.class_id].periodRanges.push({
            start,
            end,
            dueAtTime: resolvedDueAt || end
        });
    });

    Object.keys(duePolicyByClass).forEach(classId => {
        duePolicyByClass[classId].periodRanges.sort((a, b) => a.start.localeCompare(b.start));
    });

    const permissionsByClass = {};
    (permissionsData || []).forEach(row => {
        permissionsByClass[row.class_id] = {
            canCreateProjects: row.can_create_projects,
            canJoinProjects: row.can_join_projects,
            canSignOut: row.can_sign_out,
            autoTriggerAttentionOnSignIn: !!row.auto_trigger_attention_on_sign_in,
            auto_trigger_attention_on_sign_in: !!row.auto_trigger_attention_on_sign_in
        };
    });

    studentClasses = (classesRes.data || []).map(cls => ({
        id: cls.id,
        name: cls.name,
        teacherId: cls.teacher_id,
        students: studentsByClass[cls.id] || [],
        visibleItemIds: itemsByClass[cls.id] || [],
        allowedVisibilityTags: tagsByClass[cls.id] || [],
        duePolicy: duePolicyByClass[cls.id] || {
            defaultSignoutMinutes: 80,
            timezone: 'America/Edmonton',
            periodRanges: [{ start: '08:00', end: '08:55', dueAtTime: '08:55' }]
        },
        defaultPermissions: permissionsByClass[cls.id] || {
            canCreateProjects: false,
            canJoinProjects: true,
            canSignOut: true,
            autoTriggerAttentionOnSignIn: false,
            auto_trigger_attention_on_sign_in: false
        }
    }));

    console.log(`Loaded ${studentClasses.length} student classes`);
}

/**
 * Upsert a student class and all child relations
 */
async function saveStudentClassToSupabase(cls) {
    const isSchemaColumnError = (error) => {
        const msg = String(error?.message || '').toLowerCase();
        return /column .* does not exist/i.test(String(error?.message || ''))
            || msg.includes('could not find the')
            || msg.includes('schema cache')
            || msg.includes('undefined_column');
    };

    const parseMinutes = (timeString) => {
        const [hours, minutes] = String(timeString || '').split(':').map(Number);
        if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
        return (hours * 60) + minutes;
    };

    const duePolicy = cls.duePolicy || {
        defaultSignoutMinutes: 80,
        timezone: 'America/Edmonton',
        periodRanges: [{ start: '08:00', end: '08:55', dueAtTime: '08:55' }]
    };

    const defaultPermissions = cls.defaultPermissions || {
        canCreateProjects: false,
        canJoinProjects: true,
        canSignOut: true,
        autoTriggerAttentionOnSignIn: false,
        auto_trigger_attention_on_sign_in: false
    };

    let classId = cls.id;

    let { error: classError } = await dbClient.from('student_classes').upsert([
        {
            id: classId,
            name: cls.name,
            teacher_id: cls.teacherId || null
        }
    ], { onConflict: 'id' });

    // If table expects UUID and caller passed a non-UUID id, retry with a generated UUID.
    if (classError && (String(classError.code || '') === '22P02' || /uuid/i.test(String(classError.message || '')))) {
        classId = createUuid();
        ({ error: classError } = await dbClient.from('student_classes').upsert([
            {
                id: classId,
                name: cls.name,
                teacher_id: cls.teacherId || null
            }
        ], { onConflict: 'id' }));
    }

    if (classError) {
        console.error('Error upserting student_classes:', classError);
        return false;
    }

    cls.id = classId;

    const duePayload = {
        class_id: classId,
        default_signout_minutes: duePolicy.defaultSignoutMinutes,
        class_period_minutes: duePolicy.classPeriodMinutes ?? 50,
        timezone: duePolicy.timezone || 'America/Edmonton'
    };

    let { error: dueError } = await dbClient.from('class_due_policy').upsert([
        duePayload
    ], { onConflict: 'class_id' });

    if (dueError && isSchemaColumnError(dueError)) {
        const fallbackDuePayload = {
            class_id: classId,
            default_signout_minutes: duePolicy.defaultSignoutMinutes,
            timezone: duePolicy.timezone || 'America/Edmonton'
        };
        ({ error: dueError } = await dbClient.from('class_due_policy').upsert([
            fallbackDuePayload
        ], { onConflict: 'class_id' }));
    }

    if (dueError) {
        console.error('Error upserting class_due_policy:', dueError);
        return false;
    }

    const permissionsPayload = {
        class_id: classId,
        can_create_projects: !!defaultPermissions.canCreateProjects,
        can_join_projects: !!defaultPermissions.canJoinProjects,
        can_sign_out: !!defaultPermissions.canSignOut,
        auto_trigger_attention_on_sign_in: !!(
            defaultPermissions.autoTriggerAttentionOnSignIn
            ?? defaultPermissions.auto_trigger_attention_on_sign_in
        )
    };

    let { error: permissionsError } = await dbClient.from('class_permissions').upsert([
        permissionsPayload
    ], { onConflict: 'class_id' });

    if (permissionsError && isSchemaColumnError(permissionsError)) {
        const fallbackPermissionsPayload = {
            class_id: classId,
            can_create_projects: !!defaultPermissions.canCreateProjects,
            can_join_projects: !!defaultPermissions.canJoinProjects,
            can_sign_out: !!defaultPermissions.canSignOut
        };

        ({ error: permissionsError } = await dbClient.from('class_permissions').upsert([
            fallbackPermissionsPayload
        ], { onConflict: 'class_id' }));
    }

    if (permissionsError) {
        console.error('Error upserting class_permissions:', permissionsError);
        return false;
    }

    const { error: clearStudentsError } = await dbClient.from('class_students').delete().eq('class_id', classId);
    if (clearStudentsError) {
        console.error('Error clearing class_students:', clearStudentsError);
        return false;
    }
    if ((cls.students || []).length > 0) {
        const { error: insertStudentsError } = await dbClient.from('class_students').insert(
            cls.students.map(studentId => ({ class_id: classId, student_id: studentId }))
        );
        if (insertStudentsError) {
            console.error('Error inserting class_students:', insertStudentsError);
            return false;
        }
    }

    const { error: clearItemsError } = await dbClient.from('class_visible_items').delete().eq('class_id', classId);
    if (clearItemsError) {
        console.error('Error clearing class_visible_items:', clearItemsError);
        return false;
    }
    if ((cls.visibleItemIds || []).length > 0) {
        const { error: insertItemsError } = await dbClient.from('class_visible_items').insert(
            cls.visibleItemIds.map(itemId => ({ class_id: classId, item_id: itemId }))
        );
        if (insertItemsError) {
            console.error('Error inserting class_visible_items:', insertItemsError);
            return false;
        }
    }

    const { error: clearTagsError } = await dbClient.from('class_visibility_tags').delete().eq('class_id', classId);
    if (clearTagsError) {
        console.error('Error clearing class_visibility_tags:', clearTagsError);
        return false;
    }
    if ((cls.allowedVisibilityTags || []).length > 0) {
        const { data: tagRows, error: tagsLookupError } = await dbClient.from('visibility_tags')
            .select('id, name')
            .in('name', cls.allowedVisibilityTags);
        if (tagsLookupError) {
            console.error('Error looking up visibility_tags:', tagsLookupError);
            return false;
        }

        if ((tagRows || []).length > 0) {
            const { error: insertTagsError } = await dbClient.from('class_visibility_tags').insert(
                tagRows.map(tag => ({ class_id: classId, tag_id: tag.id }))
            );
            if (insertTagsError) {
                console.error('Error inserting class_visibility_tags:', insertTagsError);
                return false;
            }
        }
    }

    const { error: clearPeriodsError } = await dbClient.from('class_due_policy_periods').delete().eq('class_id', classId);
    if (clearPeriodsError) {
        console.error('Error clearing class_due_policy_periods:', clearPeriodsError);
        return false;
    }
    if ((duePolicy.periodRanges || []).length > 0) {
        const periodRows = duePolicy.periodRanges.map(period => {
            const dueAt = period.dueAtTime || period.end;
            const endMinutes = parseMinutes(period.end);
            const dueAtMinutes = parseMinutes(dueAt);
            const minsBeforeEnd = (endMinutes !== null && dueAtMinutes !== null)
                ? Math.max(0, endMinutes - dueAtMinutes)
                : 0;

            return {
                class_id: classId,
                start_time: period.start,
                end_time: period.end,
                return_class_periods: 1,
                due_mode: 'minutes_before_end',
                due_minutes_before_end: minsBeforeEnd,
                due_at_time: dueAt
            };
        });

        let { error: insertPeriodsError } = await dbClient
            .from('class_due_policy_periods')
            .insert(periodRows);

        if (insertPeriodsError && isSchemaColumnError(insertPeriodsError)) {
            const noDueAtRows = periodRows.map(row => ({
                class_id: row.class_id,
                start_time: row.start_time,
                end_time: row.end_time,
                return_class_periods: row.return_class_periods,
                due_mode: row.due_mode,
                due_minutes_before_end: row.due_minutes_before_end
            }));
            ({ error: insertPeriodsError } = await dbClient
                .from('class_due_policy_periods')
                .insert(noDueAtRows));
        }

        if (insertPeriodsError && isSchemaColumnError(insertPeriodsError)) {
            const minimalRows = periodRows.map(row => ({
                class_id: row.class_id,
                start_time: row.start_time,
                end_time: row.end_time,
                return_class_periods: row.return_class_periods
            }));
            ({ error: insertPeriodsError } = await dbClient
                .from('class_due_policy_periods')
                .insert(minimalRows));
        }

        if (insertPeriodsError) {
            console.error('Error inserting class_due_policy_periods:', insertPeriodsError);
            return false;
        }
    }

    return true;
}

/**
 * Delete a student class and cascading related rows
 */
async function deleteStudentClassInSupabase(classId) {
    const { error } = await dbClient.from('student_classes').delete().eq('id', classId);
    if (error) {
        console.error('Error deleting student class:', error);
        return false;
    }
    return true;
}

/* =======================================
   WRITE FUNCTIONS (Create/Update/Delete)
   ======================================= */

/**
 * Add a new user to the users table
 */
async function addUserToSupabase(user) {
    const isMissingGradeColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .*grade|grade.*does not exist/i.test(String(err?.message || ''))
            || (msg.includes('could not find') && msg.includes('grade') && msg.includes('schema cache'));
    };

    const isMissingSignInAttentionColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .*auto_trigger_attention_on_sign_in|auto_trigger_attention_on_sign_in.*does not exist/i.test(String(err?.message || ''))
            || (msg.includes('could not find') && msg.includes('auto_trigger_attention_on_sign_in') && msg.includes('schema cache'));
    };

    const isSchemaColumnError = (err) => isMissingGradeColumnError(err) || isMissingSignInAttentionColumnError(err);

    const payload = {
        id: user.id,
        name: user.name,
        role: user.role,
        grade: user.grade || null,
        status: user.status || 'Active',
        auto_trigger_attention_on_sign_in: user.auto_trigger_attention_on_sign_in ?? user.autoTriggerAttentionOnSignIn ?? false
    };

    let { data, error } = await dbClient.from('users').insert([payload]).select();

    if (error && isSchemaColumnError(error)) {
        const fallbackPayloads = [
            {
                id: user.id,
                name: user.name,
                role: user.role,
                status: user.status || 'Active',
                auto_trigger_attention_on_sign_in: user.auto_trigger_attention_on_sign_in ?? user.autoTriggerAttentionOnSignIn ?? false
            },
            {
                id: user.id,
                name: user.name,
                role: user.role,
                grade: user.grade || null,
                status: user.status || 'Active'
            },
            {
                id: user.id,
                name: user.name,
                role: user.role,
                status: user.status || 'Active'
            }
        ];

        for (const fallbackPayload of fallbackPayloads) {
            ({ data, error } = await dbClient.from('users').insert([fallbackPayload]).select());
            if (!error) break;
            if (!isSchemaColumnError(error)) break;
        }
    }
    
    if (error) {
        console.error('Error adding user:', error);
        return null;
    }
    return data?.[0] || user;
}

/**
 * Update user in the users table
 */
async function updateUserInSupabase(userId, updates) {
    const isMissingGradeColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .*grade|grade.*does not exist/i.test(String(err?.message || ''))
            || (msg.includes('could not find') && msg.includes('grade') && msg.includes('schema cache'));
    };

    const isMissingSignInAttentionColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .*auto_trigger_attention_on_sign_in|auto_trigger_attention_on_sign_in.*does not exist/i.test(String(err?.message || ''))
            || (msg.includes('could not find') && msg.includes('auto_trigger_attention_on_sign_in') && msg.includes('schema cache'));
    };

    const isSchemaColumnError = (err) => isMissingGradeColumnError(err) || isMissingSignInAttentionColumnError(err);

    let { data, error } = await dbClient.from('users')
        .update(updates)
        .eq('id', userId).select();

    if (error && isSchemaColumnError(error)) {
        const fallbackUpdates = { ...(updates || {}) };
        if (isMissingGradeColumnError(error) && Object.prototype.hasOwnProperty.call(fallbackUpdates, 'grade')) {
            delete fallbackUpdates.grade;
        }
        if (isMissingSignInAttentionColumnError(error) && Object.prototype.hasOwnProperty.call(fallbackUpdates, 'auto_trigger_attention_on_sign_in')) {
            delete fallbackUpdates.auto_trigger_attention_on_sign_in;
        }

        ({ data, error } = await dbClient.from('users')
            .update(fallbackUpdates)
            .eq('id', userId).select());
    }
    
    if (error) {
        const errorMessage = error.message || JSON.stringify(error);
        console.error('Error updating user:', error);
        // Return error info so caller can show meaningful message
        return {
            data: null,
            error: {
                message: errorMessage,
                details: error.details,
                hint: error.hint,
                code: error.code
            }
        };
    }
    return {
        data: data?.[0],
        error: null
    };
}

/**
 * Persist per-user permission overrides.
 * Tries users.perms JSON first, then users boolean columns, then user_permissions table.
 */
async function saveUserPermissionsToSupabase(userId, perms) {
    const isSchemaEntityError = (err) => {
        const message = String(err?.message || '').toLowerCase();
        const code = String(err?.code || '').toUpperCase();
        return message.includes('does not exist')
            || message.includes('schema cache')
            || message.includes('could not find')
            || code === '42703'
            || code === '42P01'
            || code === 'PGRST204';
    };

    const normalizedPerms = {
        canCreateProjects: !!perms?.canCreateProjects,
        canJoinProjects: !!perms?.canJoinProjects,
        canSignOut: !!perms?.canSignOut
    };

    // Preferred: JSON permissions payload directly on users row.
    {
        const { error } = await dbClient
            .from('users')
            .update({ perms: normalizedPerms })
            .eq('id', userId)
            .select('id')
            .maybeSingle();

        if (!error) {
            return { data: null, error: null, persisted: true, strategy: 'users.perms' };
        }

        if (!isSchemaEntityError(error)) {
            console.error('Error updating users.perms:', error);
            return { data: null, error, persisted: false };
        }
    }

    // Fallback: explicit boolean columns on users.
    {
        const { error } = await dbClient
            .from('users')
            .update({
                can_create_projects: normalizedPerms.canCreateProjects,
                can_join_projects: normalizedPerms.canJoinProjects,
                can_sign_out: normalizedPerms.canSignOut
            })
            .eq('id', userId)
            .select('id')
            .maybeSingle();

        if (!error) {
            return { data: null, error: null, persisted: true, strategy: 'users.boolean_columns' };
        }

        if (!isSchemaEntityError(error)) {
            console.error('Error updating users permission columns:', error);
            return { data: null, error, persisted: false };
        }
    }

    // Final fallback: dedicated user_permissions table.
    {
        const { error } = await dbClient
            .from('user_permissions')
            .upsert([
                {
                    user_id: userId,
                    can_create_projects: normalizedPerms.canCreateProjects,
                    can_join_projects: normalizedPerms.canJoinProjects,
                    can_sign_out: normalizedPerms.canSignOut
                }
            ], { onConflict: 'user_id' });

        if (!error) {
            return { data: null, error: null, persisted: true, strategy: 'user_permissions_table' };
        }

        if (isSchemaEntityError(error)) {
            return { data: null, error: null, persisted: false, unsupported: true };
        }

        console.error('Error persisting user permissions:', error);
        return { data: null, error, persisted: false };
    }
}

/**
 * Rename a user's barcode/id and keep common relational references aligned.
 */
async function renameUserBarcodeInSupabase(oldUserId, newUserId) {
    if (!oldUserId || !newUserId) return false;
    if (oldUserId === newUserId) return true;

    const { data: existing, error: existingError } = await dbClient
        .from('users')
        .select('id')
        .eq('id', newUserId)
        .maybeSingle();

    if (existingError) {
        console.error('Error checking for duplicate user barcode:', existingError);
        return false;
    }

    if (existing) {
        console.error('Cannot rename user barcode: target barcode already exists.');
        return false;
    }

    const { error: userRenameError } = await dbClient
        .from('users')
        .update({ id: newUserId })
        .eq('id', oldUserId);

    if (userRenameError) {
        console.error('Error renaming user barcode:', userRenameError);
        return false;
    }

    const referenceUpdates = [
        { table: 'projects', column: 'owner_id' },
        { table: 'project_collaborators', column: 'user_id' },
        { table: 'activity_logs', column: 'user_id' },
        { table: 'extension_requests', column: 'user_id' },
        { table: 'class_students', column: 'student_id' },
        { table: 'student_classes', column: 'teacher_id' }
    ];

    for (const { table, column } of referenceUpdates) {
        const { error } = await dbClient
            .from(table)
            .update({ [column]: newUserId })
            .eq(column, oldUserId);

        if (error) {
            console.error(`Error updating ${table}.${column} during user barcode rename:`, error);
            return false;
        }
    }

    return true;
}

/**
 * Delete user from users table
 */
async function deleteUserFromSupabase(userId) {
    const { error } = await dbClient.from('users')
        .delete()
        .eq('id', userId);

    if (error) {
        console.error('Error deleting user:', error);
        return false;
    }
    return true;
}

/**
 * Delete inventory item and related references from supporting tables.
 */
async function deleteInventoryItemFromSupabase(itemId) {
    if (!itemId) return false;

    const relations = [
        { table: 'project_items_out', column: 'item_id' },
        { table: 'inventory_item_visibility', column: 'item_id' },
        { table: 'class_visible_items', column: 'item_id' }
    ];

    for (const relation of relations) {
        const { error } = await dbClient
            .from(relation.table)
            .delete()
            .eq(relation.column, itemId);

        if (error) {
            console.error(`Error deleting ${relation.table} links for item ${itemId}:`, error);
            return false;
        }
    }

    const { error } = await dbClient
        .from('inventory_items')
        .delete()
        .eq('id', itemId);

    if (error) {
        console.error('Error deleting inventory item:', error);
        return false;
    }

    return true;
}

/**
 * Add inventory item to inventory_items table
 */
async function addItemToSupabase(item) {
    const isSchemaColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .* does not exist/i.test(String(err?.message || ''))
            || msg.includes('could not find the')
            || msg.includes('schema cache')
            || msg.includes('undefined_column');
    };

    const resolvedThreshold = Number.isFinite(Number(item.threshold))
        ? Math.max(0, Number(item.threshold))
        : 0;

    const payload = {
        id: item.id,
        name: item.name,
        category: item.category,
        sku: item.sku,
        stock: item.stock || 0,
        threshold: resolvedThreshold,
        status: item.status || 'Active',
        part_number: item.part_number || null,
        location: item.location || item.storageLocation || null,
        brand: item.brand || null,
        supplier: item.supplier || null,
        image_link: item.image_link || item.imageLink || null,
        supplier_listing_link: item.supplier_listing_link || item.supplierListingLink || null,
        item_type: item.item_type || 'item',
        visibility_level: item.visibility_level || 'standard',
        requires_door_unlock: item.requires_door_unlock ?? item.requiresDoorUnlock ?? true
    };

    let { data, error } = await dbClient.from('inventory_items').insert([payload]).select();

    if (error && isSchemaColumnError(error)) {
        const fallbackPayloads = [
            {
                ...payload,
                supplier_listing_link: undefined
            },
            {
                ...payload,
                supplier_listing_link: undefined,
                image_link: undefined
            },
            {
                ...payload,
                supplier_listing_link: undefined,
                image_link: undefined,
                supplier: undefined,
                brand: undefined,
                location: undefined,
                requires_door_unlock: undefined
            },
            {
                id: item.id,
                name: item.name,
                category: item.category,
                sku: item.sku,
                stock: item.stock || 0,
                threshold: resolvedThreshold,
                status: item.status || 'Active',
                part_number: item.part_number || null,
                item_type: item.item_type || 'item',
                visibility_level: item.visibility_level || 'standard'
            }
        ];

        for (const candidate of fallbackPayloads) {
            const cleaned = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined));
            ({ data, error } = await dbClient.from('inventory_items').insert([cleaned]).select());
            if (!error) break;
            if (!isSchemaColumnError(error)) break;
        }
    }
    
    if (error) {
        console.error('Error adding item:', error);
        return null;
    }
    return data?.[0] || item;
}

/**
 * Update inventory item in inventory_items table
 */
async function updateItemInSupabase(itemId, updates) {
    const isSchemaColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .* does not exist/i.test(String(err?.message || ''))
            || msg.includes('could not find the')
            || msg.includes('schema cache')
            || msg.includes('undefined_column');
    };

    const isMissingDoorUnlockColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return isSchemaColumnError(err) && msg.includes('requires_door_unlock');
    };

    const wantsDoorUnlockUpdate = Object.prototype.hasOwnProperty.call(updates || {}, 'requires_door_unlock')
        || Object.prototype.hasOwnProperty.call(updates || {}, 'requiresDoorUnlock');

    let { data, error } = await dbClient.from('inventory_items')
        .update(updates)
        .eq('id', itemId).select();

    if (error && wantsDoorUnlockUpdate && isMissingDoorUnlockColumnError(error)) {
        console.error('Error updating item: inventory_items.requires_door_unlock column is missing. Run SQL migration 20260330_add_requires_door_unlock.sql.', error);
        return null;
    }

    if (error && isSchemaColumnError(error)) {
        const safeUpdates = { ...updates };
        delete safeUpdates.location;
        delete safeUpdates.storageLocation;
        delete safeUpdates.brand;
        delete safeUpdates.supplier;
        delete safeUpdates.image_link;
        delete safeUpdates.supplier_listing_link;

        ({ data, error } = await dbClient.from('inventory_items')
            .update(safeUpdates)
            .eq('id', itemId).select());

        if (error && wantsDoorUnlockUpdate && isMissingDoorUnlockColumnError(error)) {
            console.error('Error updating item: inventory_items.requires_door_unlock column is missing. Run SQL migration 20260330_add_requires_door_unlock.sql.', error);
            return null;
        }
    }
    
    if (error) {
        console.error('Error updating item:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Add project to projects table
 */
async function addProjectToSupabase(project) {
    const isSchemaColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .* does not exist/i.test(String(err?.message || ''))
            || msg.includes('could not find the')
            || msg.includes('schema cache')
            || msg.includes('undefined_column');
    };

    const payload = {
        id: project.id,
        name: project.name,
        owner_id: project.ownerId,
        description: project.description || '',
        status: project.status || 'Active',
        class_id: project.classId || project.class_id || null
    };

    let { data, error } = await dbClient.from('projects').insert([payload]).select();

    if (error && isSchemaColumnError(error)) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.class_id;
        ({ data, error } = await dbClient.from('projects').insert([fallbackPayload]).select());
    }
    
    if (error) {
        console.error('Error adding project:', error);
        return null;
    }
    return data?.[0] || project;
}

/**
 * Ensure a project row exists in Supabase (used for personal projects during sign-out).
 */
async function ensureProjectExistsInSupabase(project) {
    if (!project?.id) return false;

    const { data, error } = await dbClient.from('projects').select('id').eq('id', project.id).maybeSingle();
    if (error) {
        console.error('Error checking project existence:', error);
        return false;
    }

    if (data?.id) return true;

    const created = await addProjectToSupabase({
        id: project.id,
        name: project.name || 'Personal Use',
        ownerId: project.ownerId,
        description: project.description || '',
        status: project.status || 'Active',
        classId: project.classId || project.class_id || null
    });

    return !!created;
}

/**
 * Update project in projects table
 */
async function updateProjectInSupabase(projectId, updates) {
    const { data, error } = await dbClient.from('projects')
        .update(updates)
        .eq('id', projectId).select();
    
    if (error) {
        console.error('Error updating project:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Delete project row (also clears collaborators to avoid FK dependency issues).
 */
async function deleteProjectFromSupabase(projectId) {
    if (!projectId) return false;

    const { error: collabError } = await dbClient
        .from('project_collaborators')
        .delete()
        .eq('project_id', projectId);

    if (collabError) {
        console.error('Error deleting project collaborators:', collabError);
        return false;
    }

    const { error } = await dbClient
        .from('projects')
        .delete()
        .eq('id', projectId);

    if (error) {
        console.error('Error deleting project:', error);
        return false;
    }

    return true;
}

async function insertProjectItemOutToSupabase(itemOut, { triggerLed = true } = {}) {
    lastProjectItemOutError = '';

    const normalizedId = String(itemOut.id || createUuid()).trim();
    const normalizedQty = Math.max(1, parseInt(itemOut.quantity, 10) || 1);

    const payload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        assigned_to_user_id: itemOut.assignedToUserId || null,
        signed_out_by_user_id: itemOut.signedOutByUserId || null
    };

    const fallbackPayload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate
    };

    const minimalPayload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate
    };

    const payloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        assigned_to_user_id: itemOut.assignedToUserId || null,
        signed_out_by_user_id: itemOut.signedOutByUserId || null
    };

    const fallbackPayloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate
    };

    const minimalPayloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate
    };

    let data = null;
    let error = null;

    const attempts = [
        payload,
        payloadNoId,
        fallbackPayload,
        fallbackPayloadNoId,
        minimalPayload,
        minimalPayloadNoId
    ];

    let firstErrorText = '';

    for (const attemptPayload of attempts) {
        ({ data, error } = await dbClient.from('project_items_out').insert([attemptPayload]).select());
        if (!error) break;
        const currentErrorText = `${error.code || 'db_error'}: ${error.message || 'insert failed'}`;
        if (!firstErrorText) firstErrorText = currentErrorText;
        lastProjectItemOutError = currentErrorText;
    }
    
    if (error) {
        if (firstErrorText) {
            lastProjectItemOutError = firstErrorText;
        }
        console.error('Error adding project item out:', error);
        return null;
    }

    if (triggerLed && shouldTriggerLedForItem(itemOut)) {
        notifySignoutLedTrigger();
    }
    return data?.[0];
}

/**
 * Add project item out to project_items_out table
 */
async function addProjectItemOutToSupabase(itemOut) {
    return insertProjectItemOutToSupabase(itemOut, { triggerLed: true });
}

/**
 * Add multiple project item out rows and roll back any inserted rows on failure.
 */
async function addProjectItemOutBatchToSupabase(itemOuts) {
    lastProjectItemOutError = '';

    const items = Array.isArray(itemOuts) ? itemOuts.filter(Boolean) : [];
    if (items.length === 0) return [];

    const insertedRows = [];
    const shouldTriggerLed = items.some(itemOut => shouldTriggerLedForItem(itemOut));

    for (const itemOut of items) {
        const savedRow = await insertProjectItemOutToSupabase(itemOut, { triggerLed: false });
        if (!savedRow) {
            for (const insertedRow of insertedRows.slice().reverse()) {
                await returnItemToSupabase(insertedRow.id);
            }
            return null;
        }
        insertedRows.push(savedRow);
    }

    if (shouldTriggerLed) {
        notifySignoutLedTrigger();
    }

    return insertedRows;
}

/**
 * Return item (delete from project_items_out)
 */
async function returnItemToSupabase(projectItemOutId) {
    const { error } = await dbClient.from('project_items_out')
        .delete()
        .eq('id', projectItemOutId);
    
    if (error) {
        console.error('Error returning item:', error);
        return false;
    }
    return true;
}

/**
 * Return item by composite fields when legacy in-memory rows do not have id.
 */
async function returnItemByCompositeToSupabase({ projectId, itemId, signoutDate, quantity }) {
    let query = dbClient
        .from('project_items_out')
        .delete()
        .eq('project_id', projectId)
        .eq('item_id', itemId)
        .eq('quantity', quantity);

    if (signoutDate) {
        query = query.eq('signout_date', signoutDate);
    }

    const { error } = await query;
    if (error) {
        console.error('Error returning item by composite key:', error);
        return false;
    }
    return true;
}

/**
 * Update due date for an existing project item out row
 */
async function updateProjectItemOutDueDateInSupabase(projectItemOutId, dueDate) {
    const { data, error } = await dbClient.from('project_items_out')
        .update({ due_date: dueDate })
        .eq('id', projectItemOutId).select();

    if (error) {
        console.error('Error updating project item due date:', error);
        return null;
    }
    return data?.[0] || null;
}

/**
 * Move an existing signed-out row to another project.
 * Uses row id when available; falls back to composite delete + insert.
 */
async function moveProjectItemOutToProjectInSupabase({
    projectItemOutId,
    fromProjectId,
    toProjectId,
    itemId,
    quantity,
    signoutDate,
    dueDate,
    assignedToUserId,
    signedOutByUserId
}) {
    if (!toProjectId) return null;

    if (projectItemOutId) {
        const { data, error } = await dbClient
            .from('project_items_out')
            .update({ project_id: toProjectId })
            .eq('id', projectItemOutId)
            .select();

        if (!error) return data?.[0] || null;

        console.error('Error moving project item by id, falling back to delete/insert:', error);
    }

    const removed = await returnItemByCompositeToSupabase({
        projectId: fromProjectId,
        itemId,
        signoutDate,
        quantity
    });

    if (!removed) return null;

    return addProjectItemOutToSupabase({
        projectId: toProjectId,
        itemId,
        quantity,
        signoutDate,
        dueDate,
        assignedToUserId,
        signedOutByUserId
    });
}

/**
 * Add activity log to activity_logs table
 */
async function addActivityLogToSupabase(log) {
    const { data, error } = await dbClient.from('activity_logs').insert([{
        id: log.id,
        timestamp: log.timestamp,
        user_id: log.userId,
        action: log.action,
        details: log.details
    }]).select();
    
    if (error) {
        console.error('Error adding activity log:', error);
        return null;
    }
    return data?.[0] || log;
}

/**
 * Add help request to help_requests table
 */
async function addHelpRequestToSupabase(request) {
    const { data, error } = await dbClient.from('help_requests').insert([{
        id: request.id,
        name: request.name,
        email: request.email,
        description: request.description,
        status: request.status || 'Pending',
        timestamp: request.timestamp
    }]).select();
    
    if (error) {
        console.error('Error adding help request:', error);
        return null;
    }
    return data?.[0] || request;
}

/**
 * Update help request status
 */
async function updateHelpRequestInSupabase(requestId, status) {
    const { data, error } = await dbClient.from('help_requests')
        .update({ status })
        .eq('id', requestId).select();
    
    if (error) {
        console.error('Error updating help request:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Add extension request to extension_requests table
 */
async function addExtensionRequestToSupabase(request) {
    const { data, error } = await dbClient.from('extension_requests').insert([{
        id: request.id,
        user_id: request.userId,
        user_name: request.userName,
        item_id: request.itemId,
        item_name: request.itemName,
        project_name: request.projectName,
        current_due: request.currentDue,
        requested_due: request.requestedDue,
        status: request.status || 'Pending',
        timestamp: request.timestamp
    }]).select();
    
    if (error) {
        console.error('Error adding extension request:', error);
        return null;
    }
    return data?.[0] || request;
}

/**
 * Update extension request status
 */
async function updateExtensionRequestInSupabase(requestId, status) {
    const { data, error } = await dbClient.from('extension_requests')
        .update({ status })
        .eq('id', requestId).select();

    if (error) {
        console.error('Error updating extension request:', error);
        return null;
    }
    return data?.[0] || null;
}

/**
 * Add order request to order_requests table
 */
async function addOrderRequestToSupabase(request) {
    const payload = {
        requested_by_user_id: request.requestedByUserId,
        requested_by_name: request.requestedByName,
        item_name: request.itemName,
        category: request.category,
        quantity: request.quantity,
        justification: request.justification,
        status: request.status || 'Pending',
        timestamp: request.timestamp
    };

    if (request.id) payload.id = request.id;

    let { data, error } = await dbClient.from('order_requests').insert([payload]).select();

    // If `id` format is invalid for this table (e.g., UUID expected), retry using DB default id.
    if (error && payload.id && (String(error.code || '') === '22P02' || /uuid/i.test(String(error.message || '')))) {
        delete payload.id;
        ({ data, error } = await dbClient.from('order_requests').insert([payload]).select());
    }

    if (error) {
        console.error('Error adding order request:', error);
        return null;
    }

    return data?.[0] || request;
}

/**
 * Update order request status
 */
async function updateOrderRequestInSupabase(requestId, status) {
    const { data, error } = await dbClient.from('order_requests')
        .update({ status })
        .eq('id', requestId)
        .select();

    if (error) {
        console.error('Error updating order request status:', error);
        return null;
    }

    return data?.[0] || null;
}

/**
 * Add system flag row.
 */
async function addSystemFlagToSupabase(flag) {
    const payload = {
        id: flag.id,
        flag_type: flag.flag_type || 'System',
        item_id: flag.item_id || null,
        project_id: flag.project_id || null,
        actor_user_id: flag.actor_user_id || null,
        assigned_user_id: flag.assigned_user_id || null,
        details: flag.details || '',
        status: flag.status || 'Open',
        created_at: flag.timestamp || new Date().toISOString()
    };

    let { data, error } = await dbClient.from('system_flags').insert([payload]).select();

    if (error && (String(error.code || '') === '22P02' || /uuid/i.test(String(error.message || '')))) {
        delete payload.id;
        ({ data, error } = await dbClient.from('system_flags').insert([payload]).select());
    }

    if (error) {
        console.error('Error adding system flag:', error);
        return null;
    }

    return data?.[0] || null;
}

/**
 * Update system flag status.
 */
async function updateSystemFlagStatusInSupabase(flagId, status) {
    const updates = {
        status,
        archived_at: status === 'Archived' ? new Date().toISOString() : null
    };

    const { data, error } = await dbClient.from('system_flags')
        .update(updates)
        .eq('id', flagId)
        .select();

    if (error) {
        console.error('Error updating system flag status:', error);
        return null;
    }

    return data?.[0] || null;
}

/**
 * Add category to categories table
 */
async function addCategoryToSupabase(name) {
    const { data, error } = await dbClient.from('categories').insert([{ name }]).select();
    
    if (error) {
        console.error('Error adding category:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Delete category from categories table
 */
async function deleteCategoryFromSupabase(name) {
    const { error } = await dbClient.from('categories')
        .delete()
        .eq('name', name);
    
    if (error) {
        console.error('Error deleting category:', error);
        return false;
    }
    return true;
}

/**
 * Rename category and move existing inventory items to new category
 */
async function renameCategoryInSupabase(oldName, newName) {
    const { data: existing, error: existingErr } = await dbClient.from('categories')
        .select('name')
        .eq('name', newName)
        .maybeSingle();

    if (existingErr) {
        console.error('Error checking existing category:', existingErr);
        return false;
    }

    if (!existing) {
        const { error: addErr } = await dbClient.from('categories').insert([{ name: newName }]).select();
        if (addErr) {
            console.error('Error creating new category name:', addErr);
            return false;
        }
    }

    const { error: updateItemsErr } = await dbClient.from('inventory_items')
        .update({ category: newName })
        .eq('category', oldName).select();

    if (updateItemsErr) {
        console.error('Error reassigning inventory item categories:', updateItemsErr);
        return false;
    }

    const { error: deleteOldErr } = await dbClient.from('categories')
        .delete()
        .eq('name', oldName);

    if (deleteOldErr) {
        console.error('Error deleting old category name:', deleteOldErr);
        return false;
    }

    return true;
}

/**
 * Add visibility tag to visibility_tags table
 */
async function addVisibilityTagToSupabase(name) {
    const { data, error } = await dbClient.from('visibility_tags').insert([{ name }]).select();
    
    if (error) {
        console.error('Error adding visibility tag:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Rename visibility tag
 */
async function renameVisibilityTagInSupabase(oldName, newName) {
    const { data, error } = await dbClient.from('visibility_tags')
        .update({ name: newName })
        .eq('name', oldName).select();

    if (error) {
        console.error('Error renaming visibility tag:', error);
        return null;
    }
    return data?.[0] || null;
}

/**
 * Delete visibility tag by name
 */
async function deleteVisibilityTagFromSupabase(name) {
    const { error } = await dbClient.from('visibility_tags')
        .delete()
        .eq('name', name);

    if (error) {
        console.error('Error deleting visibility tag:', error);
        return false;
    }
    return true;
}

/**
 * Link visibility tag to inventory item
 */
async function addItemVisibilityTagToSupabase(itemId, tagId) {
    const { data, error } = await dbClient.from('inventory_item_visibility').insert([{
        item_id: itemId,
        tag_id: tagId
    }]).select();
    
    if (error) {
        console.error('Error adding item visibility tag:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Replace all visibility tags for an inventory item
 */
async function setItemVisibilityTagsInSupabase(itemId, tagNames) {
    const { error: clearError } = await dbClient.from('inventory_item_visibility')
        .delete()
        .eq('item_id', itemId);

    if (clearError) {
        console.error('Error clearing item visibility tags:', clearError);
        return false;
    }

    if (!Array.isArray(tagNames) || tagNames.length === 0) {
        return true;
    }

    const { data: tagRows, error: tagsError } = await dbClient.from('visibility_tags')
        .select('id, name')
        .in('name', tagNames);

    if (tagsError) {
        console.error('Error loading tag IDs:', tagsError);
        return false;
    }

    if (!tagRows || tagRows.length === 0) {
        return true;
    }

    const links = tagRows.map(tag => ({ item_id: itemId, tag_id: tag.id }));
    const { error: insertError } = await dbClient.from('inventory_item_visibility')
        .insert(links);

    if (insertError) {
        console.error('Error setting item visibility tags:', insertError);
        return false;
    }

    return true;
}

/**
 * Add project collaborator
 */
async function addProjectCollaboratorToSupabase(projectId, userId) {
    const { data, error } = await dbClient.from('project_collaborators').insert([{
        project_id: projectId,
        user_id: userId
    }]).select();
    
    if (error) {
        console.error('Error adding project collaborator:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Remove project collaborator
 */
async function removeProjectCollaboratorFromSupabase(projectId, userId) {
    const { error } = await dbClient.from('project_collaborators')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId);
    
    if (error) {
        console.error('Error removing project collaborator:', error);
        return false;
    }
    return true;
}

/* =======================================
   APP-LEVEL HELPER FUNCTIONS
   ======================================= */

/**
 * Add activity log (local + Supabase)
 */
function addLog(userId, action, details) {
    const log = {
        id: `LOG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        userId: userId,
        action: action,
        details: details
    };
    
    // Add to local array
    activityLogs.unshift(log);
    
    // Save to Supabase (fire and forget - don't await)
    addActivityLogToSupabase(log).catch(err => {
        console.error('Failed to log activity to Supabase:', err);
    });
    
    return log;
}


