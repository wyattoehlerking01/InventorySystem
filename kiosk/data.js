/* =======================================
   SUPABASE CLIENT & INITIALIZATION
   ======================================= */

// Initialize Supabase client
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_ENV || {};

function resolveLedTriggerUrl(userId) {
    const explicitUrl = String(window.APP_ENV?.LED_TRIGGER_URL || '').trim();
    let base = explicitUrl;
    if (!base) {
        const gpioUrl = String(window.APP_ENV?.GPIO_SERVER_URL || '').trim();
        if (gpioUrl) {
            try {
                const parsed = new URL(gpioUrl);
                parsed.pathname = '/trigger';
                parsed.search = '';
                parsed.hash = '';
                base = parsed.toString();
            } catch {
                base = '';
            }
        }
    }
    if (!base) return '';

    const effectiveUserId = userId || (typeof currentUser !== 'undefined' && currentUser?.id) || (typeof window !== 'undefined' && window.currentUser?.id) || '';
    if (!effectiveUserId) return base;

    try {
        const parsed = new URL(base, (typeof window !== 'undefined' && window.location?.origin) || 'http://127.0.0.1:8090');
        parsed.searchParams.set('userid', String(effectiveUserId));
        return parsed.toString();
    } catch {
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}userid=${encodeURIComponent(String(effectiveUserId))}`;
    }
}

const LED_TRIGGER_URL = resolveLedTriggerUrl();

function notifySignoutLedTrigger(userId) {
    const effectiveUserId = userId || (typeof currentUser !== 'undefined' && currentUser?.id) || (typeof window !== 'undefined' && window.currentUser?.id) || '';
    const targetUrl = resolveLedTriggerUrl(effectiveUserId);
    if (!targetUrl) return;
    if (typeof fetch !== 'function') {
        console.warn('LED trigger skipped: fetch is unavailable in this environment.');
        return;
    }

    // Fire-and-forget: this should never block checkout UX.
    Promise.resolve().then(() => {
        void fetch(targetUrl, {
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

function normalizeBarcodePart(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\|/g, '')
        .toUpperCase();
}

function sortAlphanumericNatural(list) {
    return (list || []).slice().sort((a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }));
}

function composeInventoryBarcode({ mainCategory, subCategory, brand, itemName, name } = {}) {
    const parts = [mainCategory, subCategory, brand, itemName ?? name].map(normalizeBarcodePart);
    if (parts.some(part => !part)) return '';
    return parts.join('|');
}

function getInventoryMainCategory(item) {
    return String(item?.main_category ?? item?.mainCategory ?? item?.category ?? 'Uncategorized').trim() || 'Uncategorized';
}

function getInventorySubCategory(item) {
    return String(item?.sub_category ?? item?.subCategory ?? 'General').trim() || 'General';
}

function getInventoryItemBarcode(item) {
    if (!item) return '';
    const storedBarcode = String(item?.sku ?? item?.barcode ?? '').trim().toUpperCase();
    if (storedBarcode) return storedBarcode;
    const composed = composeInventoryBarcode({
        mainCategory: getInventoryMainCategory(item),
        subCategory: getInventorySubCategory(item),
        brand: item?.brand || 'Unspecified',
        itemName: item?.name || 'Unnamed Item'
    });
    return composed;
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

/* =======================================
   GLOBAL DATA ARRAYS (from Supabase)
   ======================================= */

let inventoryItems = [];
let inventoryItemBundles = [];
let mockUsers = [];
let projects = [];
let studentClasses = [];
let categories = [];
let visibilityTags = [];
let activityLogs = [];
let helpRequests = [];
let extensionRequests = [];
let orderRequests = [];
let systemFlags = [];
let lastProjectItemOutError = '';

const ACTIVITY_LOG_QUEUE_KEY = 'kiosk.activityLogQueue.v1';
const ACTIVITY_LOG_MAX_QUEUE_ITEMS = 500;
const ACTIVITY_LOG_MAX_BACKOFF_MS = 5 * 60 * 1000;
let activityLogQueue = loadActivityLogQueueFromStorage();
let activityLogQueueFlushInFlight = false;
let activityLogQueueFlushTimeoutId = null;

function getLastProjectItemOutError() {
    return String(lastProjectItemOutError || '').trim();
}

function loadActivityLogQueueFromStorage() {
    if (typeof localStorage === 'undefined') return [];

    try {
        const raw = localStorage.getItem(ACTIVITY_LOG_QUEUE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map(entry => {
                const log = entry?.log;
                if (!log || !log.id) return null;

                return {
                    log: {
                        id: String(log.id),
                        timestamp: String(log.timestamp || new Date().toISOString()),
                        userId: String(log.userId || 'SYSTEM'),
                        action: String(log.action || 'Activity'),
                        details: String(log.details || '')
                    },
                    attempts: Math.max(0, parseInt(entry?.attempts, 10) || 0),
                    nextRetryAt: Math.max(0, parseInt(entry?.nextRetryAt, 10) || 0),
                    lastError: String(entry?.lastError || '')
                };
            })
            .filter(Boolean);
    } catch (error) {
        console.warn('Failed to load activity log queue from localStorage:', error);
        return [];
    }
}

function persistActivityLogQueue() {
    if (typeof localStorage === 'undefined') return;

    try {
        localStorage.setItem(ACTIVITY_LOG_QUEUE_KEY, JSON.stringify(activityLogQueue));
    } catch (error) {
        console.warn('Failed to persist activity log queue:', error);
    }
}

function getActivityLogBackoffMs(attempts) {
    const expMs = Math.min(ACTIVITY_LOG_MAX_BACKOFF_MS, 1000 * (2 ** Math.min(8, attempts)));
    const jitterMs = Math.floor(Math.random() * 300);
    return Math.min(ACTIVITY_LOG_MAX_BACKOFF_MS, expMs + jitterMs);
}

function scheduleActivityLogQueueFlush(delayMs = 0) {
    const delay = Math.max(0, parseInt(delayMs, 10) || 0);

    if (activityLogQueueFlushTimeoutId) {
        clearTimeout(activityLogQueueFlushTimeoutId);
    }

    activityLogQueueFlushTimeoutId = setTimeout(() => {
        activityLogQueueFlushTimeoutId = null;
        flushActivityLogQueue().catch(error => {
            console.warn('Scheduled activity log queue flush failed:', error);
        });
    }, delay);
}

function queueActivityLog(log) {
    const existingIndex = activityLogQueue.findIndex(entry => entry?.log?.id === log.id);
    if (existingIndex >= 0) {
        activityLogQueue[existingIndex].log = log;
        persistActivityLogQueue();
        return;
    }

    activityLogQueue.push({
        log,
        attempts: 0,
        nextRetryAt: 0,
        lastError: ''
    });

    if (activityLogQueue.length > ACTIVITY_LOG_MAX_QUEUE_ITEMS) {
        activityLogQueue = activityLogQueue.slice(activityLogQueue.length - ACTIVITY_LOG_MAX_QUEUE_ITEMS);
    }

    persistActivityLogQueue();
}

async function flushActivityLogQueue(options = {}) {
    if (activityLogQueueFlushInFlight) return false;
    if (!Array.isArray(activityLogQueue) || activityLogQueue.length === 0) return true;

    const maxBatch = Math.max(1, parseInt(options.maxBatch, 10) || 25);
    const force = !!options.force;
    const now = Date.now();
    let processed = 0;
    let changed = false;

    activityLogQueueFlushInFlight = true;

    try {
        for (let i = 0; i < activityLogQueue.length && processed < maxBatch;) {
            const entry = activityLogQueue[i];
            if (!entry || !entry.log) {
                activityLogQueue.splice(i, 1);
                changed = true;
                continue;
            }

            if (!force && entry.nextRetryAt > now) {
                i += 1;
                continue;
            }

            processed += 1;
            const result = await addActivityLogToSupabase(entry.log);

            if (result?.ok) {
                activityLogQueue.splice(i, 1);
                changed = true;
                continue;
            }

            const attempts = (parseInt(entry.attempts, 10) || 0) + 1;
            const retryable = result?.retryable !== false;
            entry.attempts = attempts;
            entry.lastError = String(result?.errorMessage || 'Unknown activity log persistence error.');
            entry.nextRetryAt = retryable ? Date.now() + getActivityLogBackoffMs(attempts) : Date.now() + ACTIVITY_LOG_MAX_BACKOFF_MS;
            activityLogQueue[i] = entry;
            changed = true;
            i += 1;
        }
    } finally {
        activityLogQueueFlushInFlight = false;
        if (changed) persistActivityLogQueue();
    }

    if (activityLogQueue.length > 0) {
        let nextDelay = ACTIVITY_LOG_MAX_BACKOFF_MS;
        const ts = Date.now();
        for (const entry of activityLogQueue) {
            const retryAt = Math.max(0, parseInt(entry?.nextRetryAt, 10) || 0);
            if (retryAt <= ts) {
                nextDelay = 0;
                break;
            }
            nextDelay = Math.min(nextDelay, retryAt - ts);
        }
        scheduleActivityLogQueueFlush(nextDelay);
    }

    return activityLogQueue.length === 0;
}

/* =======================================
   DATA LOADING FUNCTIONS
   ======================================= */

/**
 * Load only public catalog / metadata needed before user login.
 * Does NOT load sensitive records (activity logs, users, requests, projects, door sessions).
 */
async function loadPreLoginData() {
    requireSupabaseClient('loadPreLoginData');

    try {
        await Promise.all([
            loadCategories(),
            loadVisibilityTags(),
            loadInventoryItems(),
            loadInventoryItemVisibility()
        ]);
        console.log('Pre-login public catalog data loaded successfully.');
    } catch (error) {
        console.error('Error loading pre-login data from Supabase:', error);
        throw error;
    }
}

/**
 * Load role-appropriate user data after successful authentication.
 */
async function loadUserData(user) {
    if (!user) return;
    requireSupabaseClient('loadUserData');

    try {
        const isElevated = user.role === 'teacher' || user.role === 'developer';

        const promises = [
            loadUsers(),
            loadProjects(),
            loadStudentClasses(),
            loadProjectCollaborators(),
            loadProjectItemsOut(),
            loadInventoryItems(),
            loadInventoryItemVisibility()
        ];

        if (isElevated) {
            promises.push(
                loadActivityLogs(),
                loadHelpRequests(),
                loadExtensionRequests(),
                loadOrderRequests(),
                loadSystemFlags()
            );
        } else {
            // Student: Clear elevated queues and logs to prevent leakage
            activityLogs = [];
            helpRequests = [];
            extensionRequests = [];
            orderRequests = [];
            systemFlags = [];
        }

        await Promise.all(promises);
        console.log(`User data loaded successfully for ${user.role} ${user.name}`);
    } catch (error) {
        console.error('Error loading user data from Supabase:', error);
        throw error;
    }
}

/**
 * Wipe all sensitive session data on logout.
 */
function clearSensitiveDataOnLogout() {
    activityLogs = [];
    helpRequests = [];
    extensionRequests = [];
    orderRequests = [];
    systemFlags = [];
    projects = [];
    studentClasses = [];
    mockUsers = [];
    console.log('Cleared sensitive session data on logout.');
}

/**
 * Load all data from Supabase tables (maintenance / elevated use)
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
 * Load users from public.users table (selecting safe profile fields)
 */
async function loadUsers() {
    let { data, error } = await dbClient
        .from('users')
        .select('id, name, email, role, grade, barcode, avatar, personal_items_enabled, status, created_at');

    if (error) {
        // Fallback for schemas missing some extended columns
        const fallback = await dbClient.from('users').select('*');
        if (fallback.error) {
            console.error('Error loading users:', fallback.error);
            return;
        }
        data = fallback.data;
    }
    const normalizePersonalItemsEnabled = (value) => {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
            if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
        }
        return false;
    };

    mockUsers = (data || []).map(user => ({
        ...user,
        personalItemsEnabled: normalizePersonalItemsEnabled(user?.personal_items_enabled ?? user?.personalItemsEnabled),
        personal_items_enabled: normalizePersonalItemsEnabled(user?.personal_items_enabled ?? user?.personalItemsEnabled)
    }));
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
        main_category: row.main_category ?? row.mainCategory ?? row.category ?? 'Uncategorized',
        sub_category: row.sub_category ?? row.subCategory ?? 'General',
        category: row.category ?? row.main_category ?? row.mainCategory ?? 'Uncategorized',
        brand: row.brand ?? row.supplier ?? 'Unspecified',
        storageLocation: row.storageLocation ?? row.storage_location ?? row.location ?? null,
        imageLink: row.imageLink ?? row.image_link ?? null,
        supplierListingLink: row.supplierListingLink ?? row.supplier_listing_link ?? null,
        requiresDoorUnlock: row.requiresDoorUnlock ?? row.requires_door_unlock ?? true,
        sku: row.sku ?? row.barcode ?? getInventoryItemBarcode(row),
        item_type: row.item_type || 'item',
        visibility_level: row.visibility_level || 'standard'
    }));

    await loadInventoryItemBundles();
    hydrateInventoryItemBundles();
    console.log(`Loaded ${inventoryItems.length} inventory items`);
}

function isBundleItemType(itemType) {
    return String(itemType || '').trim().toLowerCase() === 'bundle';
}

function getBundleComponentRowsForBundleItem(bundleItemId) {
    return (inventoryItemBundles || [])
        .filter(row => String(row.bundle_item_id || '') === String(bundleItemId || ''))
        .map(row => ({
            id: row.id,
            bundleItemId: row.bundle_item_id,
            componentItemId: row.component_item_id,
            componentQuantity: Math.max(1, parseInt(row.component_quantity, 10) || 1)
        }));
}

function computeBundleAvailability(bundleItemId) {
    const components = getBundleComponentRowsForBundleItem(bundleItemId);
    if (components.length === 0) return 0;

    let availability = Number.POSITIVE_INFINITY;
    for (const component of components) {
        const childItem = inventoryItems.find(item => item.id === component.componentItemId);
        const componentStock = Math.max(0, parseInt(childItem?.stock, 10) || 0);
        const componentBundles = Math.floor(componentStock / Math.max(1, component.componentQuantity));
        availability = Math.min(availability, componentBundles);
    }

    return Number.isFinite(availability) ? Math.max(0, availability) : 0;
}

function hydrateInventoryItemBundles() {
    if (!Array.isArray(inventoryItems) || inventoryItems.length === 0) return;

    const bundleItems = new Set((inventoryItemBundles || []).map(row => String(row.bundle_item_id || '')));
    inventoryItems = inventoryItems.map(item => {
        const isBundle = isBundleItemType(item.item_type) || bundleItems.has(String(item.id || ''));
        if (!isBundle) return item;

        const bundleComponents = getBundleComponentRowsForBundleItem(item.id)
            .map(component => ({
                ...component,
                componentItem: inventoryItems.find(child => child.id === component.componentItemId) || null
            }))
            .filter(component => component.componentItemId);
        const bundleStock = computeBundleAvailability(item.id);

        return {
            ...item,
            item_type: 'bundle',
            bundleComponents,
            bundleStock,
            stock: bundleStock
        };
    });
}

async function loadInventoryItemBundles() {
    const { data, error } = await dbClient.from('inventory_item_bundles').select('*');
    if (error) {
        const message = String(error?.message || '').toLowerCase();
        const code = String(error?.code || '').toUpperCase();
        const missingTableError = message.includes('does not exist') || code === '42P01' || code === 'PGRST204';
        if (missingTableError) {
            inventoryItemBundles = [];
            return;
        }
        console.error('Error loading inventory item bundles:', error);
        return;
    }

    inventoryItemBundles = (data || []).map(row => ({
        ...row,
        bundle_item_id: row.bundle_item_id,
        component_item_id: row.component_item_id,
        component_quantity: Math.max(1, parseInt(row.component_quantity, 10) || 1)
    }));

    hydrateInventoryItemBundles();
    console.log(`Loaded ${inventoryItemBundles.length} inventory bundle component rows`);
}

/**
 * Reload inventory items and visibility tags from Supabase
 */
async function refreshInventoryFromSupabase() {
    await loadInventoryItems();
    await loadInventoryItemVisibility();
    await loadInventoryItemBundles();
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
        collaboratorRoles: {},
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
    categories = sortAlphanumericNatural((data || []).map(c => c.name).filter(Boolean));
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
    visibilityTags = sortAlphanumericNatural((data || []).map(t => t.name).filter(Boolean));
    console.log(`Loaded ${visibilityTags.length} visibility tags`);
}

/**
 * Load activity logs from public.activity_logs table
 */
async function loadActivityLogs() {
    const { data, error } = await dbClient
        .from('activity_logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);
    if (error) {
        console.error('Error loading activity logs:', error);
        return;
    }
    activityLogs = data || [];

    // Merge recent door open sessions and raw door sensor events into activity logs for kiosk view
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
                let durMs = Number(s.duration_ms || 0) || 0;

                // If duration not provided, calculate from timestamps. If closedAt missing, use now.
                try {
                    if (!durMs && openedAt) {
                        if (closedAt) {
                            durMs = Math.max(0, closedAt.getTime() - openedAt.getTime());
                        } else {
                            durMs = Math.max(0, Date.now() - openedAt.getTime());
                        }
                    }
                } catch (e) {
                    durMs = Number(s.duration_ms || 0) || 0;
                }

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

        // Also include raw door sensor events (open/close) for richer activity context
        try {
            const { data: sensorEvents, error: seErr } = await dbClient
                .from('door_sensor_events')
                .select('id, event_type, event_ts, actor_user_id, sensor_id, kiosk_id, created_at')
                .eq('kiosk_id', kioskId)
                .in('event_type', ['open', 'close'])
                .order('event_ts', { ascending: false })
                .limit(50);

            if (seErr) {
                console.warn('Error loading door sensor events:', seErr);
            } else if (Array.isArray(sensorEvents) && sensorEvents.length > 0) {
                const sensorActivities = sensorEvents.map(s => {
                    const ts = s.event_ts || s.created_at || null;
                    const actor = s.actor_user_id || s.actorUserId || 'SYSTEM';
                    const sensor = s.sensor_id || s.sensorId || 'door-1';
                    const verb = String(s.event_type || '').toLowerCase();
                    const timeText = ts ? new Date(ts).toLocaleString() : 'Unknown';

                    return {
                        id: `door_sensor:${s.id}`,
                        user_id: actor,
                        action: `Sensor ${sensor} reported ${verb} at ${timeText} (actor: ${actor}).`,
                        timestamp: ts
                    };
                });

                activityLogs = (activityLogs || []).concat(sensorActivities);
            }
        } catch (err) {
            console.warn('Failed to load door sensor events for activity log:', err);
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
 * Load student messages for a user. Falls back to localStorage if DB unavailable.
 */
async function loadStudentMessages(userId) {
    if (!userId) return [];
    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `student_messages:${userId}`;
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn('loadStudentMessages fallback failed', e);
            return [];
        }
    }

    try {
        const { data, error } = await dbClient
            .from('student_messages')
            .select('*')
            .eq('target_user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            console.warn('Error loading student messages:', error);
            return [];
        }

        return (data || []).map(row => ({
            ...row,
            unread: !row.read_at
        }));
    } catch (err) {
        console.warn('loadStudentMessages failed', err);
        return [];
    }
}

async function markStudentMessagesRead(userId, messageIds = []) {
    if (!userId) return false;
    const ids = Array.from(new Set((messageIds || []).map(id => String(id || '').trim()).filter(Boolean)));
    if (ids.length === 0) return false;

    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `student_messages:${userId}`;
            const messages = JSON.parse(localStorage.getItem(key) || '[]');
            const now = new Date().toISOString();
            const updated = (messages || []).map(message => ids.includes(String(message.id || '')) ? { ...message, read_at: now } : message);
            localStorage.setItem(key, JSON.stringify(updated));
            return true;
        } catch (e) {
            console.warn('markStudentMessagesRead fallback failed', e);
            return false;
        }
    }

    try {
        const { error } = await dbClient
            .from('student_messages')
            .update({ read_at: new Date().toISOString() })
            .eq('target_user_id', userId)
            .in('id', ids);
        if (error) {
            console.warn('markStudentMessagesRead failed:', error);
            return false;
        }
        return true;
    } catch (err) {
        console.warn('markStudentMessagesRead failed', err);
        return false;
    }
}

/**
 * Onboarding state helpers. For now persist in DB when available, else localStorage.
 */
async function loadOnboardingState(userId) {
    if (!userId) return { completed: false };
    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `onboarding_state:${userId}`;
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : { completed: false };
        } catch (e) {
            console.warn('loadOnboardingState fallback failed', e);
            return { completed: false };
        }
    }

    try {
        const { data, error } = await dbClient.from('onboarding_state').select('*').eq('user_id', userId).maybeSingle();
        if (error) {
            console.warn('Error loading onboarding state:', error);
            return { completed: false };
        }
        return data || { completed: false };
    } catch (err) {
        console.warn('loadOnboardingState failed', err);
        return { completed: false };
    }
}

async function setOnboardingComplete(userId) {
    if (!userId) return false;
    if (typeof dbClient === 'undefined' || !dbClient) {
        try {
            const key = `onboarding_state:${userId}`;
            const payload = { completed: true, completed_at: new Date().toISOString() };
            localStorage.setItem(key, JSON.stringify(payload));
            return true;
        } catch (e) {
            console.warn('setOnboardingComplete fallback failed', e);
            return false;
        }
    }

    try {
        const existing = await dbClient.from('onboarding_state').select('*').eq('user_id', userId).maybeSingle();
        if (existing.error) {
            // Try insert
            const { data, error } = await dbClient.from('onboarding_state').insert([{ user_id: userId, completed: true, completed_at: new Date().toISOString() }]).select();
            return !error;
        }
        // Upsert
        const { data, error } = await dbClient.from('onboarding_state').upsert({ user_id: userId, completed: true, completed_at: new Date().toISOString() }).select();
        return !error;
    } catch (err) {
        console.warn('setOnboardingComplete failed', err);
        return false;
    }
}

async function isStudentTourCompleted(userId) {
    const state = await loadOnboardingState(userId);
    return !!state?.completed;
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
    const normalizeMemberRole = (value) => {
        const normalized = String(value || 'collaborator').trim().toLowerCase();
        return ['collaborator', 'mentor', 'captain'].includes(normalized) ? normalized : 'collaborator';
    };

    const { data, error } = await dbClient.from('project_collaborators').select('project_id, user_id, member_role');
    if (error) {
        const message = String(error?.message || '').toLowerCase();
        const code = String(error?.code || '').toUpperCase();
        const missingColumnError = message.includes('member_role') && (message.includes('does not exist') || code === '42703' || code === 'PGRST204');

        if (!missingColumnError) {
            console.error('Error loading project collaborators:', error);
            return;
        }

        const fallback = await dbClient.from('project_collaborators').select('project_id, user_id');
        if (fallback.error) {
            console.error('Error loading project collaborators:', fallback.error);
            return;
        }

        (fallback.data || []).forEach(collab => {
            const project = projects.find(p => p.id === collab.project_id);
            if (project && !project.collaborators.includes(collab.user_id)) {
                project.collaborators.push(collab.user_id);
            }
            if (project) {
                project.collaboratorRoles = project.collaboratorRoles || {};
                project.collaboratorRoles[collab.user_id] = 'collaborator';
            }
        });
        return;
    }
    
    (data || []).forEach(collab => {
        const project = projects.find(p => p.id === collab.project_id);
        if (project && !project.collaborators.includes(collab.user_id)) {
            project.collaborators.push(collab.user_id);
        }
        if (project) {
            project.collaboratorRoles = project.collaboratorRoles || {};
            project.collaboratorRoles[collab.user_id] = normalizeMemberRole(collab.member_role);
        }
    });
}

/**
 * Load project items out and attach to projects
 */
async function loadProjectItemsOut() {
    const isMissingTableError = (err) => {
        const message = String(err?.message || '').toLowerCase();
        const code = String(err?.code || '').toUpperCase();
        return message.includes('does not exist') || code === '42P01' || code === 'PGRST204';
    };

    // Reset itemsOut on all existing projects to prevent accumulation on reloads
    if (Array.isArray(projects)) {
        projects.forEach(p => {
            p.itemsOut = [];
        });
    }

    const [itemsOutResult, bundleTxResult] = await Promise.all([
        dbClient.from('project_items_out').select('*'),
        dbClient.from('project_item_bundle_transactions').select('*')
    ]);

    if (itemsOutResult.error) {
        console.error('Error loading project items out:', itemsOutResult.error);
        return;
    }

    if (bundleTxResult.error && !isMissingTableError(bundleTxResult.error)) {
        console.error('Error loading project bundle transactions:', bundleTxResult.error);
    }

    const bundleTransactions = (bundleTxResult.data || []).reduce((map, row) => {
        map[String(row.id || '')] = row;
        return map;
    }, {});

    const bundleChildren = (itemsOutResult.data || []).reduce((map, row) => {
        const bundleId = String(row.bundle_transaction_id || '').trim();
        if (!bundleId) return map;
        if (!map[bundleId]) map[bundleId] = [];
        map[bundleId].push(row);
        return map;
    }, {});

    (itemsOutResult.data || []).forEach(io => {
        if (io.bundle_transaction_id) return;

        let project = projects.find(p => p.id === io.project_id);
        if (!project) {
            const isPersonal = String(io.project_id || '').startsWith('PERS-');
            const isClass = String(io.project_id || '').startsWith('CLASS-');
            const assignedUserId = io.assigned_to_user_id ?? io.assignedToUserId ?? io.signed_out_by_user_id ?? '';
            project = {
                id: io.project_id,
                name: isPersonal ? 'My Items (Personal)' : (isClass ? 'Class Checkout' : 'Project Items'),
                ownerId: assignedUserId,
                collaborators: [],
                collaboratorRoles: {},
                itemsOut: [],
                status: 'Active'
            };
            projects.push(project);
        }

        const ioRecord = {
            id: io.id,
            itemId: io.item_id,
            quantity: io.quantity,
            signoutDate: io.signout_date,
            dueDate: io.due_date,
            assignedToUserId: io.assigned_to_user_id ?? io.assignedToUserId ?? null,
            signedOutByUserId: io.signed_out_by_user_id ?? io.signedOutByUserId ?? null
        };

        const alreadyExists = (project.itemsOut || []).some(existing => 
            (existing.id && io.id && existing.id === io.id) ||
            (existing.itemId === io.item_id && existing.signoutDate === io.signout_date && existing.quantity === io.quantity && String(existing.assignedToUserId || '') === String(ioRecord.assignedToUserId || ''))
        );

        if (!alreadyExists) {
            project.itemsOut.push(ioRecord);
        }
    });

    Object.values(bundleTransactions).forEach(tx => {
        let project = projects.find(p => p.id === tx.project_id);
        if (!project) {
            const isPersonal = String(tx.project_id || '').startsWith('PERS-');
            const isClass = String(tx.project_id || '').startsWith('CLASS-');
            const assignedUserId = tx.assigned_to_user_id ?? tx.assignedToUserId ?? tx.signed_out_by_user_id ?? '';
            project = {
                id: tx.project_id,
                name: isPersonal ? 'My Items (Personal)' : (isClass ? 'Class Checkout' : 'Project Items'),
                ownerId: assignedUserId,
                collaborators: [],
                collaboratorRoles: {},
                itemsOut: [],
                status: 'Active'
            };
            projects.push(project);
        }

        const children = (bundleChildren[String(tx.id || '')] || []).map(row => ({
            id: row.id,
            itemId: row.item_id,
            quantity: row.quantity,
            signoutDate: row.signout_date,
            dueDate: row.due_date,
            assignedToUserId: row.assigned_to_user_id ?? row.assignedToUserId ?? null,
            signedOutByUserId: row.signed_out_by_user_id ?? row.signedOutByUserId ?? null,
            bundleTransactionId: row.bundle_transaction_id
        }));

        const alreadyExists = (project.itemsOut || []).some(existing => 
            existing.id && tx.id && existing.id === tx.id
        );

        if (!alreadyExists) {
            project.itemsOut.push({
                id: tx.id,
                itemId: tx.bundle_item_id,
                quantity: tx.bundle_quantity,
                signoutDate: tx.signout_date,
                dueDate: tx.due_date,
                assignedToUserId: tx.assigned_to_user_id ?? tx.assignedToUserId ?? null,
                signedOutByUserId: tx.signed_out_by_user_id ?? tx.signedOutByUserId ?? null,
                bundleTransactionId: tx.id,
                bundleComponents: children,
                isBundle: true
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
            if (tagMap[iv.tag_id] && !item.visibilityTags.includes(tagMap[iv.tag_id])) {
                item.visibilityTags.push(tagMap[iv.tag_id]);
            }
        }
    });

    inventoryItems.forEach(item => {
        if (Array.isArray(item.visibilityTags)) {
            item.visibilityTags = sortAlphanumericNatural(item.visibilityTags);
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
        auto_trigger_attention_on_sign_in: user.auto_trigger_attention_on_sign_in ?? user.autoTriggerAttentionOnSignIn ?? false,
        personal_items_enabled: user.personal_items_enabled ?? user.personalItemsEnabled ?? false
    };

    let { data, error } = await dbClient.from('users').insert([payload]).select();

    if (error && isSchemaColumnError(error)) {
        const fallbackPayloads = [
            {
                id: user.id,
                name: user.name,
                role: user.role,
                status: user.status || 'Active',
                auto_trigger_attention_on_sign_in: user.auto_trigger_attention_on_sign_in ?? user.autoTriggerAttentionOnSignIn ?? false,
                personal_items_enabled: user.personal_items_enabled ?? user.personalItemsEnabled ?? false
            },
            {
                id: user.id,
                name: user.name,
                role: user.role,
                grade: user.grade || null,
                status: user.status || 'Active',
                personal_items_enabled: user.personal_items_enabled ?? user.personalItemsEnabled ?? false
            },
            {
                id: user.id,
                name: user.name,
                role: user.role,
                status: user.status || 'Active',
                personal_items_enabled: user.personal_items_enabled ?? user.personalItemsEnabled ?? false
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

    const isMissingPersonalItemsColumnError = (err) => {
        const msg = String(err?.message || '').toLowerCase();
        return /column .*personal_items_enabled|personal_items_enabled.*does not exist/i.test(String(err?.message || ''))
            || (msg.includes('could not find') && msg.includes('personal_items_enabled') && msg.includes('schema cache'));
    };

    const isSchemaColumnError = (err) => isMissingGradeColumnError(err) || isMissingSignInAttentionColumnError(err) || isMissingPersonalItemsColumnError(err);

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
        if (isMissingPersonalItemsColumnError(error) && Object.prototype.hasOwnProperty.call(fallbackUpdates, 'personal_items_enabled')) {
            delete fallbackUpdates.personal_items_enabled;
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
 * Delete one inventory item and related references.
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

    const payload = {
        id: item.id,
        name: item.name,
        main_category: item.main_category || item.mainCategory || item.category || 'Uncategorized',
        sub_category: item.sub_category || item.subCategory || 'General',
        category: item.category || item.main_category || item.mainCategory || 'Uncategorized',
        sku: item.sku || composeInventoryBarcode({
            mainCategory: item.main_category || item.mainCategory || item.category,
            subCategory: item.sub_category || item.subCategory,
            brand: item.brand,
            itemName: item.name
        }),
        stock: item.stock || 0,
        threshold: item.threshold || 5,
        status: item.status || 'Active',
        part_number: item.part_number || null,
        location: item.location || item.storageLocation || null,
        brand: item.brand || item.supplier || null,
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
                brand: undefined,
                location: undefined,
                requires_door_unlock: undefined
            },
            {
                id: item.id,
                name: item.name,
                main_category: payload.main_category,
                sub_category: payload.sub_category,
                category: payload.category,
                sku: payload.sku,
                stock: item.stock || 0,
                threshold: item.threshold || 5,
                status: item.status || 'Active',
                part_number: item.part_number || null,
                item_type: item.item_type || 'item',
                visibility_level: item.visibility_level || 'standard',
                brand: item.brand || item.supplier || null
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

    const normalizedUpdates = { ...(updates || {}) };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'supplier') && !Object.prototype.hasOwnProperty.call(normalizedUpdates, 'brand')) {
        normalizedUpdates.brand = normalizedUpdates.supplier;
    }
    delete normalizedUpdates.supplier;

    const wantsDoorUnlockUpdate = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'requires_door_unlock')
        || Object.prototype.hasOwnProperty.call(normalizedUpdates, 'requiresDoorUnlock');

    let { data, error } = await dbClient.from('inventory_items')
        .update(normalizedUpdates)
        .eq('id', itemId).select();

    if (error && wantsDoorUnlockUpdate && isMissingDoorUnlockColumnError(error)) {
        console.error('Error updating item: inventory_items.requires_door_unlock column is missing. Run SQL migration 20260330_add_requires_door_unlock.sql.', error);
        return null;
    }

    if (error && isSchemaColumnError(error)) {
        const safeUpdates = { ...normalizedUpdates };
        delete safeUpdates.main_category;
        delete safeUpdates.sub_category;
        delete safeUpdates.category;
        delete safeUpdates.location;
        delete safeUpdates.storageLocation;
        delete safeUpdates.brand;
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
    const normalizedBundleTransactionId = String(itemOut.bundleTransactionId || itemOut.bundle_transaction_id || '').trim() || null;

    const payload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        assigned_to_user_id: itemOut.assignedToUserId || null,
        signed_out_by_user_id: itemOut.signedOutByUserId || null,
        bundle_transaction_id: normalizedBundleTransactionId
    };

    const fallbackPayload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        bundle_transaction_id: normalizedBundleTransactionId
    };

    const minimalPayload = {
        id: normalizedId,
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        bundle_transaction_id: normalizedBundleTransactionId
    };

    const payloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        assigned_to_user_id: itemOut.assignedToUserId || null,
        signed_out_by_user_id: itemOut.signedOutByUserId || null,
        bundle_transaction_id: normalizedBundleTransactionId
    };

    const fallbackPayloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate,
        bundle_transaction_id: normalizedBundleTransactionId
    };

    const minimalPayloadNoId = {
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: normalizedQty,
        signout_date: itemOut.signoutDate,
        bundle_transaction_id: normalizedBundleTransactionId
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
        notifySignoutLedTrigger(itemOut?.userId || itemOut?.user_id);
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
        notifySignoutLedTrigger(items?.[0]?.userId || items?.[0]?.user_id);
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
 * Replace the component rows for a bundle item.
 */
async function saveInventoryItemBundleComponentsInSupabase(bundleItemId, components) {
    if (!bundleItemId) return false;

    const normalizedComponents = (Array.isArray(components) ? components : [])
        .map(component => ({
            bundle_item_id: bundleItemId,
            component_item_id: String(component?.componentItemId || component?.itemId || '').trim(),
            component_quantity: Math.max(1, parseInt(component?.componentQuantity || component?.quantity, 10) || 1)
        }))
        .filter(component => component.component_item_id);

    const { data: previousRows, error: previousRowsError } = await dbClient
        .from('inventory_item_bundles')
        .select('*')
        .eq('bundle_item_id', bundleItemId);

    if (previousRowsError) {
        console.error('Error loading existing bundle component rows:', previousRowsError);
        return false;
    }

    const { error: deleteError } = await dbClient
        .from('inventory_item_bundles')
        .delete()
        .eq('bundle_item_id', bundleItemId);

    if (deleteError) {
        console.error('Error clearing bundle component rows:', deleteError);
        return false;
    }

    if (normalizedComponents.length === 0) {
        inventoryItemBundles = (inventoryItemBundles || []).filter(row => String(row.bundle_item_id || '') !== String(bundleItemId));
        hydrateInventoryItemBundles();
        return true;
    }

    const { error: insertError } = await dbClient
        .from('inventory_item_bundles')
        .insert(normalizedComponents);

    if (insertError) {
        console.error('Error saving bundle component rows:', insertError);
        if ((previousRows || []).length > 0) {
            await dbClient.from('inventory_item_bundles').insert(previousRows.map(row => ({
                bundle_item_id: row.bundle_item_id,
                component_item_id: row.component_item_id,
                component_quantity: row.component_quantity
            })));
        }
        return false;
    }

    await loadInventoryItemBundles();
    return true;
}

async function addProjectBundleTransactionToSupabase(transaction) {
    const { data, error } = await dbClient.from('project_item_bundle_transactions').insert([{
        id: transaction.id || createUuid(),
        project_id: transaction.projectId,
        bundle_item_id: transaction.bundleItemId,
        bundle_quantity: Math.max(1, parseInt(transaction.bundleQuantity, 10) || 1),
        signout_date: transaction.signoutDate,
        due_date: transaction.dueDate,
        assigned_to_user_id: transaction.assignedToUserId || null,
        signed_out_by_user_id: transaction.signedOutByUserId || null
    }]).select();

    if (error) {
        console.error('Error adding bundle transaction:', error);
        return null;
    }

    return data?.[0] || transaction;
}

async function deleteBundleTransactionFromSupabase(bundleTransactionId) {
    if (!bundleTransactionId) return false;

    const { error: childDeleteError } = await dbClient
        .from('project_items_out')
        .delete()
        .eq('bundle_transaction_id', bundleTransactionId);

    if (childDeleteError) {
        console.error('Error deleting bundle child rows:', childDeleteError);
        return false;
    }

    const { error: transactionDeleteError } = await dbClient
        .from('project_item_bundle_transactions')
        .delete()
        .eq('id', bundleTransactionId);

    if (transactionDeleteError) {
        console.error('Error deleting bundle transaction row:', transactionDeleteError);
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
    signedOutByUserId,
    transferredByUserId
}) {
    if (!toProjectId) return null;

    if (projectItemOutId) {
        const { data, error } = await dbClient
            .from('project_items_out')
            .update({ project_id: toProjectId })
            .eq('id', projectItemOutId)
            .select();

        if (!error) {
            await addProjectTransferToSupabase({
                projectItemOutId,
                fromProjectId,
                toProjectId,
                itemId,
                quantity,
                signoutDate,
                dueDate,
                assignedToUserId,
                signedOutByUserId,
                transferredByUserId
            });
            return data?.[0] || null;
        }

        console.error('Error moving project item by id, falling back to delete/insert:', error);
    }

    const removed = await returnItemByCompositeToSupabase({
        projectId: fromProjectId,
        itemId,
        signoutDate,
        quantity
    });

    if (!removed) return null;

    const inserted = await addProjectItemOutToSupabase({
        projectId: toProjectId,
        itemId,
        quantity,
        signoutDate,
        dueDate,
        assignedToUserId,
        signedOutByUserId,
        transferredByUserId
    });

    if (inserted) {
        await addProjectTransferToSupabase({
            projectItemOutId: inserted.id,
            fromProjectId,
            toProjectId,
            itemId,
            quantity,
            signoutDate,
            dueDate,
            assignedToUserId,
            signedOutByUserId,
            transferredByUserId
        });
    }

    return inserted;
}

/**
 * Add activity log to activity_logs table
 */
async function addActivityLogToSupabase(log) {
    if (!dbClient) {
        return {
            ok: false,
            retryable: true,
            errorCode: 'NO_CLIENT',
            errorMessage: 'Supabase client unavailable.'
        };
    }

    try {
        const { data, error } = await dbClient.from('activity_logs').insert([{
            id: log.id,
            timestamp: log.timestamp,
            user_id: log.userId,
            action: log.action,
            details: log.details
        }]).select();

        if (error) {
            const errorCode = String(error.code || '').trim();
            const errorMessage = String(error.message || 'Unknown Supabase insert error.');

            // Duplicate insert means this log already reached the DB previously.
            if (errorCode === '23505') {
                return {
                    ok: true,
                    retryable: false,
                    errorCode,
                    errorMessage
                };
            }

            const nonRetryableCodes = new Set(['22P02', '23502', '23503', '42501']);
            const retryable = !nonRetryableCodes.has(errorCode);

            console.error('Error adding activity log:', error);
            return {
                ok: false,
                retryable,
                errorCode,
                errorMessage
            };
        }

        return {
            ok: true,
            retryable: false,
            data: data?.[0] || log
        };
    } catch (error) {
        const errorMessage = String(error?.message || error || 'Unknown exception while adding activity log.');
        console.error('Exception adding activity log:', error);
        return {
            ok: false,
            retryable: true,
            errorCode: 'EXCEPTION',
            errorMessage
        };
    }
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
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;

    try {
        const { data: existing } = await dbClient.from('categories')
            .select('name')
            .eq('name', trimmed)
            .maybeSingle();

        if (existing) {
            if (!categories.includes(trimmed)) {
                categories = sortAlphanumericNatural([...categories, trimmed]);
            }
            return existing;
        }

        const { data, error } = await dbClient.from('categories').insert([{ name: trimmed }]).select();
        if (error) {
            console.error('Error adding category:', error);
            return null;
        }
        const created = data?.[0] || { name: trimmed };
        if (!categories.includes(trimmed)) {
            categories = sortAlphanumericNatural([...categories, trimmed]);
        }
        return created;
    } catch (err) {
        console.error('Unexpected error in addCategoryToSupabase:', err);
        return null;
    }
}

/**
 * Delete category from categories table and reassign any items to Uncategorized
 */
async function deleteCategoryFromSupabase(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;

    try {
        // If deleting a category other than Uncategorized, ensure Uncategorized exists in categories
        if (trimmed.toLowerCase() !== 'uncategorized') {
            const { data: uncategorizedRow } = await dbClient.from('categories')
                .select('name')
                .ilike('name', 'Uncategorized')
                .maybeSingle();

            if (!uncategorizedRow) {
                await dbClient.from('categories').insert([{ name: 'Uncategorized' }]).select();
                if (!categories.includes('Uncategorized')) {
                    categories.push('Uncategorized');
                }
            }

            // Update inventory_items where category matches
            try {
                await dbClient.from('inventory_items')
                    .update({ category: 'Uncategorized' })
                    .ilike('category', trimmed);
            } catch (err) {
                await dbClient.from('inventory_items')
                    .update({ category: 'Uncategorized' })
                    .eq('category', trimmed);
            }

            try {
                await dbClient.from('inventory_items')
                    .update({ main_category: 'Uncategorized' })
                    .ilike('main_category', trimmed);
            } catch (err) {
                // Column may not exist or already updated
            }
        }

        const { error } = await dbClient.from('categories')
            .delete()
            .ilike('name', trimmed);

        if (error) {
            console.warn('Error deleting category with ilike, attempting exact eq:', error);
            const { error: eqErr } = await dbClient.from('categories')
                .delete()
                .eq('name', trimmed);
            if (eqErr) {
                console.error('Error deleting category from database:', eqErr);
            }
        }

        // Update in-memory collections
        categories = categories.filter(c => c.toLowerCase() !== trimmed.toLowerCase());
        if (Array.isArray(inventoryItems)) {
            inventoryItems.forEach(item => {
                if (item.category && item.category.toLowerCase() === trimmed.toLowerCase()) item.category = 'Uncategorized';
                if (item.main_category && item.main_category.toLowerCase() === trimmed.toLowerCase()) item.main_category = 'Uncategorized';
                if (item.mainCategory && item.mainCategory.toLowerCase() === trimmed.toLowerCase()) item.mainCategory = 'Uncategorized';
            });
        }

        return true;
    } catch (err) {
        console.error('Unexpected error in deleteCategoryFromSupabase:', err);
        categories = categories.filter(c => c.toLowerCase() !== trimmed.toLowerCase());
        return true;
    }
}

/**
 * Rename category and move existing inventory items to new category
 */
async function renameCategoryInSupabase(oldName, newName) {
    const trimmedOld = String(oldName || '').trim();
    const trimmedNew = String(newName || '').trim();

    if (!trimmedOld || !trimmedNew) return false;
    if (trimmedOld === trimmedNew) return true;

    try {
        const { data: existing, error: existingErr } = await dbClient.from('categories')
            .select('name')
            .eq('name', trimmedNew)
            .maybeSingle();

        if (existingErr) {
            console.error('Error checking existing category:', existingErr);
        }

        if (!existing) {
            const { error: addErr } = await dbClient.from('categories').insert([{ name: trimmedNew }]).select();
            if (addErr) {
                console.error('Error creating new category name:', addErr);
            }
        }

        // Update inventory_items
        try {
            await dbClient.from('inventory_items')
                .update({ category: trimmedNew, main_category: trimmedNew })
                .eq('category', trimmedOld);
        } catch (err) {
            await dbClient.from('inventory_items')
                .update({ category: trimmedNew })
                .eq('category', trimmedOld);
        }

        try {
            await dbClient.from('inventory_items')
                .update({ category: trimmedNew, main_category: trimmedNew })
                .eq('main_category', trimmedOld);
        } catch (err) {
            // main_category column might not exist or already updated
        }

        const { error: deleteOldErr } = await dbClient.from('categories')
            .delete()
            .eq('name', trimmedOld);

        if (deleteOldErr) {
            console.warn('Warning deleting old category name:', deleteOldErr);
        }

        // Update in-memory state
        categories = sortAlphanumericNatural([
            ...categories.filter(c => c !== trimmedOld && c !== trimmedNew),
            trimmedNew
        ]);

        if (Array.isArray(inventoryItems)) {
            inventoryItems.forEach(item => {
                if (item.category === trimmedOld) item.category = trimmedNew;
                if (item.main_category === trimmedOld) item.main_category = trimmedNew;
                if (item.mainCategory === trimmedOld) item.mainCategory = trimmedNew;
            });
        }

        return true;
    } catch (err) {
        console.error('Unexpected error in renameCategoryInSupabase:', err);
        return false;
    }
}

/**
 * Add visibility tag to visibility_tags table
 */
async function addVisibilityTagToSupabase(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;

    try {
        const { data: existing } = await dbClient.from('visibility_tags')
            .select('id, name')
            .eq('name', trimmed)
            .maybeSingle();

        if (existing) {
            if (!visibilityTags.includes(trimmed)) {
                visibilityTags = sortAlphanumericNatural([...visibilityTags, trimmed]);
            }
            return existing;
        }

        const { data, error } = await dbClient.from('visibility_tags').insert([{ name: trimmed }]).select();
        if (error) {
            console.error('Error adding visibility tag:', error);
            return null;
        }
        const created = data?.[0] || { name: trimmed };
        if (!visibilityTags.includes(trimmed)) {
            visibilityTags = sortAlphanumericNatural([...visibilityTags, trimmed]);
        }
        return created;
    } catch (err) {
        console.error('Unexpected error in addVisibilityTagToSupabase:', err);
        return null;
    }
}

/**
 * Rename visibility tag across database and classes/items
 */
async function renameVisibilityTagInSupabase(oldName, newName) {
    const trimmedOld = String(oldName || '').trim();
    const trimmedNew = String(newName || '').trim();

    if (!trimmedOld || !trimmedNew) return false;
    if (trimmedOld === trimmedNew) return true;

    try {
        const { data: oldTag } = await dbClient.from('visibility_tags')
            .select('id, name')
            .eq('name', trimmedOld)
            .maybeSingle();

        const { data: existingNewTag } = await dbClient.from('visibility_tags')
            .select('id, name')
            .eq('name', trimmedNew)
            .maybeSingle();

        if (existingNewTag && oldTag && existingNewTag.id !== oldTag.id) {
            // New tag already exists in table, merge old tag references into new tag
            const oldId = oldTag.id;
            const newId = existingNewTag.id;

            // Re-point inventory_item_visibility
            const { data: itemVis } = await dbClient.from('inventory_item_visibility')
                .select('item_id')
                .eq('tag_id', oldId);

            if (Array.isArray(itemVis) && itemVis.length > 0) {
                for (const row of itemVis) {
                    const { data: existingLink } = await dbClient.from('inventory_item_visibility')
                        .select('item_id')
                        .eq('item_id', row.item_id)
                        .eq('tag_id', newId)
                        .maybeSingle();

                    if (!existingLink) {
                        await dbClient.from('inventory_item_visibility').insert([{ item_id: row.item_id, tag_id: newId }]);
                    }
                }
                await dbClient.from('inventory_item_visibility').delete().eq('tag_id', oldId);
            }

            // Re-point class_visibility_tags
            const { data: classVis } = await dbClient.from('class_visibility_tags')
                .select('class_id')
                .eq('tag_id', oldId);

            if (Array.isArray(classVis) && classVis.length > 0) {
                for (const row of classVis) {
                    const { data: existingLink } = await dbClient.from('class_visibility_tags')
                        .select('class_id')
                        .eq('class_id', row.class_id)
                        .eq('tag_id', newId)
                        .maybeSingle();

                    if (!existingLink) {
                        await dbClient.from('class_visibility_tags').insert([{ class_id: row.class_id, tag_id: newId }]);
                    }
                }
                await dbClient.from('class_visibility_tags').delete().eq('tag_id', oldId);
            }

            // Delete the old tag row
            await dbClient.from('visibility_tags').delete().eq('id', oldId);
        } else if (oldTag) {
            const { error: updateErr } = await dbClient.from('visibility_tags')
                .update({ name: trimmedNew })
                .eq('id', oldTag.id);

            if (updateErr) {
                console.error('Error updating visibility tag name:', updateErr);
                return false;
            }
        } else {
            // Old tag didn't exist in DB; create new tag
            await dbClient.from('visibility_tags').insert([{ name: trimmedNew }]);
        }

        // Update in-memory state
        visibilityTags = sortAlphanumericNatural([
            ...visibilityTags.filter(t => t !== trimmedOld && t !== trimmedNew),
            trimmedNew
        ]);

        if (Array.isArray(inventoryItems)) {
            inventoryItems.forEach(item => {
                if (Array.isArray(item.visibilityTags)) {
                    if (item.visibilityTags.includes(trimmedOld)) {
                        item.visibilityTags = sortAlphanumericNatural([
                            ...item.visibilityTags.filter(t => t !== trimmedOld && t !== trimmedNew),
                            trimmedNew
                        ]);
                    }
                }
            });
        }

        if (Array.isArray(studentClasses)) {
            studentClasses.forEach(cls => {
                if (Array.isArray(cls.visibilityTags)) {
                    if (cls.visibilityTags.includes(trimmedOld)) {
                        cls.visibilityTags = sortAlphanumericNatural([
                            ...cls.visibilityTags.filter(t => t !== trimmedOld && t !== trimmedNew),
                            trimmedNew
                        ]);
                    }
                }
            });
        }

        return true;
    } catch (err) {
        console.error('Unexpected error in renameVisibilityTagInSupabase:', err);
        return false;
    }
}

/**
 * Delete visibility tag by name, cleaning up foreign key links in inventory and classes
 */
async function deleteVisibilityTagFromSupabase(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;

    try {
        // Find matching tag IDs
        const { data: tagRows, error: findError } = await dbClient.from('visibility_tags')
            .select('id')
            .eq('name', trimmed);

        if (findError) {
            console.error('Error finding visibility tag by name:', findError);
        }

        const tagIds = (tagRows || []).map(r => r.id).filter(Boolean);

        if (tagIds.length > 0) {
            // Delete dependent records first to satisfy foreign key constraints
            for (const tagId of tagIds) {
                await dbClient.from('inventory_item_visibility').delete().eq('tag_id', tagId);
                await dbClient.from('class_visibility_tags').delete().eq('tag_id', tagId);
            }
            // Delete the tag itself by ID
            for (const tagId of tagIds) {
                await dbClient.from('visibility_tags').delete().eq('id', tagId);
            }
        }

        // Also delete by name as a fallback
        const { error } = await dbClient.from('visibility_tags')
            .delete()
            .eq('name', trimmed);

        if (error && tagIds.length === 0) {
            console.error('Error deleting visibility tag:', error);
            return false;
        }

        // Update in-memory state
        visibilityTags = visibilityTags.filter(t => t !== trimmed);

        if (Array.isArray(inventoryItems)) {
            inventoryItems.forEach(item => {
                if (Array.isArray(item.visibilityTags)) {
                    item.visibilityTags = item.visibilityTags.filter(t => t !== trimmed);
                }
            });
        }

        if (Array.isArray(studentClasses)) {
            studentClasses.forEach(cls => {
                if (Array.isArray(cls.visibilityTags)) {
                    cls.visibilityTags = cls.visibilityTags.filter(t => t !== trimmed);
                }
            });
        }

        return true;
    } catch (err) {
        console.error('Unexpected error in deleteVisibilityTagFromSupabase:', err);
        return false;
    }
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
async function addProjectCollaboratorToSupabase(projectId, userId, memberRole = 'collaborator') {
    const role = typeof normalizeMemberRole === 'function' ? normalizeMemberRole(memberRole) : (memberRole || 'collaborator');
    
    // Maintain in-memory state immediately so newly added members are recognized right away
    if (Array.isArray(projects)) {
        const targetProj = projects.find(p => p.id === projectId);
        if (targetProj) {
            targetProj.collaborators = targetProj.collaborators || [];
            if (!targetProj.collaborators.includes(userId)) {
                targetProj.collaborators.push(userId);
            }
            targetProj.collaboratorRoles = targetProj.collaboratorRoles || {};
            targetProj.collaboratorRoles[userId] = role;
        }
    }

    let { data, error } = await dbClient.from('project_collaborators').insert([{
        project_id: projectId,
        user_id: userId,
        member_role: role
    }]).select();
    
    if (error) {
        const fallback = await dbClient.from('project_collaborators').insert([{
            project_id: projectId,
            user_id: userId
        }]).select();
        if (fallback.error) {
            console.warn('Error adding project collaborator in Supabase:', error, fallback.error);
            return { project_id: projectId, user_id: userId, member_role: role };
        }
        return fallback.data?.[0] || { project_id: projectId, user_id: userId, member_role: role };
    }
    return data?.[0] || { project_id: projectId, user_id: userId, member_role: role };
}

/**
 * Add a project transfer history row.
 */
async function addProjectTransferToSupabase(transfer) {
    const payload = {
        id: transfer.id,
        project_item_out_id: transfer.projectItemOutId || null,
        from_project_id: transfer.fromProjectId || null,
        to_project_id: transfer.toProjectId || null,
        item_id: transfer.itemId || null,
        quantity: transfer.quantity || 0,
        signout_date: transfer.signoutDate || null,
        due_date: transfer.dueDate || null,
        assigned_to_user_id: transfer.assignedToUserId || null,
        signed_out_by_user_id: transfer.signedOutByUserId || null,
        transferred_by_user_id: transfer.transferredByUserId || null,
        created_at: transfer.createdAt || new Date().toISOString()
    };

    const { data, error } = await dbClient.from('project_item_transfers').insert([payload]).select();

    if (error) {
        const message = String(error?.message || '').toLowerCase();
        const code = String(error?.code || '').toUpperCase();
        const missingTableError = message.includes('project_item_transfers') && (message.includes('does not exist') || code === '42P01' || code === 'PGRST204');

        if (!missingTableError) {
            console.error('Error adding project transfer:', error);
        }
        return null;
    }

    return data?.[0] || null;
}

/**
 * Remove project collaborator
 */
async function removeProjectCollaboratorFromSupabase(projectId, userId) {
    if (Array.isArray(projects)) {
        const targetProj = projects.find(p => p.id === projectId);
        if (targetProj) {
            targetProj.collaborators = (targetProj.collaborators || []).filter(id => id !== userId);
            if (targetProj.collaboratorRoles) {
                delete targetProj.collaboratorRoles[userId];
            }
        }
    }

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

    // Persist in queue and flush asynchronously for eventual delivery.
    queueActivityLog(log);
    scheduleActivityLogQueueFlush(0);
    
    return log;
}

/**
 * Fetch database event data and compute timeline status changes for a selected inventory item.
 */
async function fetchItemTimelineData(itemId) {
    if (!itemId) return { item: null, activityLogs: [], itemsOutRows: [], transfersRows: [], doorJobsRows: [], extensionRows: [], error: 'Item ID required' };

    let freshItem = null;
    let dbLogs = [];
    let itemsOutRows = [];
    let transfersRows = [];
    let doorJobsRows = [];
    let extensionRows = [];

    // 1. Fetch fresh item record from DB
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('inventory_items')
                .select('*')
                .eq('id', itemId)
                .maybeSingle();
            if (!error && data) {
                freshItem = {
                    ...data,
                    main_category: data.main_category ?? data.mainCategory ?? data.category ?? 'Uncategorized',
                    sub_category: data.sub_category ?? data.subCategory ?? 'General',
                    category: data.category ?? data.main_category ?? data.mainCategory ?? 'Uncategorized',
                    brand: data.brand ?? data.supplier ?? 'Unspecified',
                    storageLocation: data.storageLocation ?? data.storage_location ?? data.location ?? null,
                    imageLink: data.imageLink ?? data.image_link ?? null,
                    supplierListingLink: data.supplierListingLink ?? data.supplier_listing_link ?? null,
                    requiresDoorUnlock: data.requiresDoorUnlock ?? data.requires_door_unlock ?? true,
                    sku: data.sku ?? data.barcode ?? (typeof getInventoryItemBarcode === 'function' ? getInventoryItemBarcode(data) : data.sku)
                };
            }
        }
    } catch (e) {
        console.warn('Could not query inventory_items directly:', e);
    }

    if (!freshItem && Array.isArray(inventoryItems)) {
        freshItem = inventoryItems.find(i => String(i.id) === String(itemId)) || null;
    }

    if (!freshItem) {
        return { item: null, activityLogs: [], itemsOutRows: [], transfersRows: [], doorJobsRows: [], extensionRows: [], error: 'Item not found' };
    }

    // 2. Query activity_logs from DB
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('activity_logs')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(500);
            if (!error && Array.isArray(data)) {
                dbLogs = data;
            }

            const { data: specificLogs, error: specificError } = await dbClient
                .from('activity_logs')
                .select('*')
                .ilike('details', `%${itemId}%`)
                .order('timestamp', { ascending: false })
                .limit(100);
            if (!specificError && Array.isArray(specificLogs)) {
                const existingMap = new Set(dbLogs.map(l => String(l.id)));
                specificLogs.forEach(l => {
                    if (l && l.id && !existingMap.has(String(l.id))) {
                        dbLogs.push(l);
                        existingMap.add(String(l.id));
                    }
                });
            }
        }
    } catch (e) {
        console.warn('Could not query activity_logs directly:', e);
    }

    // Merge with in-memory activityLogs
    if (Array.isArray(activityLogs) && activityLogs.length > 0) {
        const existingMap = new Set(dbLogs.map(l => String(l.id)));
        activityLogs.forEach(l => {
            if (l && l.id && !existingMap.has(String(l.id))) {
                dbLogs.push(l);
                existingMap.add(String(l.id));
            }
        });
    }

    // 3. Query project_items_out from DB
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('project_items_out')
                .select('*')
                .eq('item_id', itemId)
                .order('signout_date', { ascending: false });
            if (!error && Array.isArray(data)) {
                itemsOutRows = data;
            }
        }
    } catch (e) {
        console.warn('Could not query project_items_out directly:', e);
    }

    // Merge with in-memory projects itemsOut
    if (Array.isArray(projects)) {
        projects.forEach(p => {
            (p.itemsOut || []).forEach(io => {
                if (String(io.itemId || io.item_id) === String(itemId)) {
                    const match = itemsOutRows.some(r => String(r.id) === String(io.id) || (r.project_id === (io.projectId || p.id) && r.signout_date === io.signoutDate));
                    if (!match) {
                        itemsOutRows.push({
                            id: io.id || `out-${Math.random()}`,
                            project_id: io.projectId || p.id,
                            item_id: io.itemId,
                            quantity: io.quantity || 1,
                            signout_date: io.signoutDate,
                            due_date: io.dueDate,
                            assigned_to_user_id: io.assignedToUserId,
                            signed_out_by_user_id: io.signedOutByUserId
                        });
                    }
                }
            });
        });
    }

    // 4. Query project_item_transfers
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('project_item_transfers')
                .select('*')
                .eq('item_id', itemId)
                .order('created_at', { ascending: false });
            if (!error && Array.isArray(data)) {
                transfersRows = data;
            }
        }
    } catch (e) {
        // Safe to ignore
    }

    // 5. Query door_unlock_jobs
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('door_unlock_jobs')
                .select('*')
                .eq('item_id', itemId)
                .order('created_at', { ascending: false })
                .limit(50);
            if (!error && Array.isArray(data)) {
                doorJobsRows = data;
            }
        }
    } catch (e) {
        // Safe to ignore
    }

    // 6. Query extension_requests
    try {
        if (dbClient) {
            const { data, error } = await dbClient
                .from('extension_requests')
                .select('*')
                .eq('item_id', itemId)
                .order('created_at', { ascending: false });
            if (!error && Array.isArray(data)) {
                extensionRows = data;
            }
        }
    } catch (e) {
        // Safe to ignore
    }

    return {
        item: freshItem,
        activityLogs: dbLogs,
        itemsOutRows,
        transfersRows,
        doorJobsRows,
        extensionRows
    };
}


