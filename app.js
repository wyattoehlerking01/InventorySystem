// LCHS Inventory System - Application Logic

/* =======================================
   STATE & INITIALIZATION
   ======================================= */
let currentUser = null;

const envConfig = window.APP_ENV || {};
const kioskId = String(envConfig.KIOSK_ID ?? envConfig.kioskId ?? '').trim();
let appVersion = String(envConfig.APP_VERSION ?? envConfig.APP_Version ?? 'VERSION').trim() || 'VERSION';
const appName = String(envConfig.APP_NAME ?? 'LCHS').trim() || 'LCHS';
const appSubtitle = String(envConfig.APP_SUBTITLE ?? 'Secure Inventory Management').trim() || 'Secure Inventory Management';
window.RUNTIME_APP_VERSION = appVersion;

let kioskVersionChannel = null;

const defaultDuePolicy = {
    defaultSignoutMinutes: 80,
    classPeriodMinutes: 50,
    timezone: 'America/Edmonton',
    periodRanges: [
        { start: '08:00', end: '08:55', returnClassPeriods: 2 }
    ]
};

let signoutPolicy = {
    defaultSignoutMinutes: defaultDuePolicy.defaultSignoutMinutes,
    classPeriodMinutes: defaultDuePolicy.classPeriodMinutes,
    timezone: defaultDuePolicy.timezone,
    periodRanges: defaultDuePolicy.periodRanges.map(range => ({ ...range }))
};

// Provide a safe fallback ID generator for forms/actions that create records.
if (typeof window.generateId !== 'function') {
    window.generateId = function generateIdFallback(prefix = 'ID') {
        const ts = Date.now().toString(36).toUpperCase();
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        return `${String(prefix || 'ID').toUpperCase()}-${ts}-${rand}`;
    };
}
const generateId = window.generateId;

// DOM Elements - Login
const loginView = document.getElementById('login-view');
const loginHelpView = document.getElementById('login-help-view');
const mainView = document.getElementById('main-view');
const barcodeInput = document.getElementById('barcode-input');
const showHelpBtn = document.getElementById('show-help-btn');
const backToLoginBtn = document.getElementById('back-to-login-btn');
const submitHelpBtn = document.getElementById('submit-help-btn');

// DOM Elements - Sidebar & Profile
const userNameEl = document.getElementById('user-name');
const userRoleEl = document.getElementById('user-role');
const navBtns = document.querySelectorAll('.nav-btn[data-target]');
const logoutBtn = document.getElementById('logout-btn');
const pageTitle = document.getElementById('page-title');
const navLogs = document.getElementById('nav-logs');
const navUsers = document.getElementById('nav-users');
const navClasses = document.getElementById('nav-classes');
const navMyItems = document.getElementById('nav-my-items');
const navOrders = document.getElementById('nav-orders');

// DOM Elements - Pages
const pages = document.querySelectorAll('.page');

const ordersStudentViewStorageKey = 'ordersStudentViewEnabled';
const defaultOrdersStudentView = String(envConfig.ALLOW_STUDENT_ORDER_VIEW || 'false').toLowerCase() === 'true';
let ordersStudentViewEnabled = localStorage.getItem(ordersStudentViewStorageKey) === null
    ? defaultOrdersStudentView
    : localStorage.getItem(ordersStudentViewStorageKey) === 'true';

let inventorySearchTerm = '';
let inventoryCategoryFilter = 'All';

// Modals & Toasts
const modalContainer = document.getElementById('modal-container');
const dynamicModal = document.getElementById('dynamic-modal');
const toastContainer = document.getElementById('toast-container');

// Inactivity Timer (3 minutes)
let inactivityTimeRemaining = 3 * 60; // seconds
let countdownInterval;

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    inactivityTimeRemaining = 3 * 60;
    updateTimerUI();

    countdownInterval = setInterval(() => {
        if (!currentUser) {
            clearInterval(countdownInterval);
            return;
        }

        // Pause timer while basket is open
        if (typeof isBasketOpen !== 'undefined' && isBasketOpen) return;

        inactivityTimeRemaining--;
        updateTimerUI();

        if (inactivityTimeRemaining <= 0) {
            clearInterval(countdownInterval);
            logout('Session expired due to inactivity');
        }
    }, 1000);
}

function updateTimerUI() {
    const timerText = document.getElementById('timer-countdown');
    const timerDisplay = document.getElementById('auto-logout-timer');
    if (!timerText || !timerDisplay) return;

    const minutes = Math.floor(inactivityTimeRemaining / 60);
    const seconds = inactivityTimeRemaining % 60;
    timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Visual warning at 30 seconds
    if (inactivityTimeRemaining <= 30) {
        timerDisplay.classList.add('warning');
    } else {
        timerDisplay.classList.remove('warning');
    }
}

function resetInactivityTimer() {
    if (currentUser) {
        inactivityTimeRemaining = 3 * 60;
        updateTimerUI();
    }
}

function withButtonPending(buttonEl, pendingLabel, callback) {
    if (!buttonEl) return;
    if (buttonEl.dataset.busy === '1') return;

    const originalHtml = buttonEl.innerHTML;
    buttonEl.dataset.busy = '1';
    buttonEl.disabled = true;
    buttonEl.innerHTML = `<i class="ph ph-spinner ph-spin"></i> ${pendingLabel}`;

    Promise.resolve()
        .then(callback)
        .finally(() => {
            buttonEl.dataset.busy = '0';
            buttonEl.disabled = false;
            buttonEl.innerHTML = originalHtml;
        });
}

/* =======================================
   LOGIN RATE LIMITING
   ======================================= */
const loginRateLimit = {
    attempts: [],
    maxAttempts: 5,
    windowMs: 30000,   // 30-second sliding window
    lockoutMs: 60000,  // 1-minute hard lockout after breaching limit
    lockedUntil: null
};

function checkLoginRateLimit() {
    const now = Date.now();

    // Still in lockout?
    if (loginRateLimit.lockedUntil && now < loginRateLimit.lockedUntil) {
        const remaining = Math.ceil((loginRateLimit.lockedUntil - now) / 1000);
        showToast(`Too many attempts. Try again in ${remaining}s.`, 'error');
        return false;
    }

    // Lockout expired — reset
    if (loginRateLimit.lockedUntil && now >= loginRateLimit.lockedUntil) {
        loginRateLimit.lockedUntil = null;
        loginRateLimit.attempts = [];
    }

    // Slide the window: discard old attempts
    loginRateLimit.attempts = loginRateLimit.attempts.filter(t => now - t < loginRateLimit.windowMs);

    return true;
}

function recordFailedLoginAttempt() {
    const now = Date.now();
    loginRateLimit.attempts = loginRateLimit.attempts.filter(t => now - t < loginRateLimit.windowMs);
    loginRateLimit.attempts.push(now);

    if (loginRateLimit.attempts.length >= loginRateLimit.maxAttempts) {
        loginRateLimit.lockedUntil = now + loginRateLimit.lockoutMs;
        showToast('Too many login attempts. Locked for 60 seconds.', 'error');
        return false;
    }

    return true;
}

function clearFailedLoginAttempts() {
    loginRateLimit.attempts = [];
}

function parseTimeToMinutes(timeString) {
    const [hours, minutes] = String(timeString || '').split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return (hours * 60) + minutes;
}

function normalizeDuePolicy(policy) {
    const fallbackRanges = defaultDuePolicy.periodRanges.map(range => ({ ...range }));
    const ranges = Array.isArray(policy?.periodRanges) ? policy.periodRanges : fallbackRanges;
    const normalizedRanges = ranges
        .map(range => ({
            start: range?.start || '',
            end: range?.end || '',
            returnClassPeriods: Math.max(1, parseInt(range?.returnClassPeriods, 10) || 1)
        }))
        .filter(range => parseTimeToMinutes(range.start) !== null && parseTimeToMinutes(range.end) !== null);

    return {
        defaultSignoutMinutes: Math.max(1, parseInt(policy?.defaultSignoutMinutes, 10) || defaultDuePolicy.defaultSignoutMinutes),
        classPeriodMinutes: Math.max(1, parseInt(policy?.classPeriodMinutes, 10) || defaultDuePolicy.classPeriodMinutes),
        timezone: policy?.timezone || defaultDuePolicy.timezone,
        periodRanges: normalizedRanges.length > 0 ? normalizedRanges : fallbackRanges
    };
}

function getEffectiveDuePolicyForUser(user) {
    if (user?.role === 'student') {
        const cls = getStudentClassForUser(user.id);
        if (cls?.duePolicy) return normalizeDuePolicy(cls.duePolicy);
    }
    return normalizeDuePolicy(signoutPolicy);
}

function getLocalTimeMinutes(date, timezone) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(date);
        const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
        const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
        return (hour * 60) + minute;
    } catch {
        return (date.getHours() * 60) + date.getMinutes();
    }
}

function getMatchingPolicyRange(date, policy) {
    const currentMinutes = getLocalTimeMinutes(date, policy.timezone || defaultDuePolicy.timezone);
    return policy.periodRanges.find(range => {
        const startMinutes = parseTimeToMinutes(range.start);
        const endMinutes = parseTimeToMinutes(range.end);
        if (startMinutes === null || endMinutes === null) return false;
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }) || null;
}

function calculateDueDate(signoutDate = new Date(), user = currentUser) {
    const duePolicy = getEffectiveDuePolicyForUser(user);
    const dueDate = new Date(signoutDate);

    const matchingRange = getMatchingPolicyRange(signoutDate, duePolicy);
    if (matchingRange) {
        dueDate.setMinutes(dueDate.getMinutes() + (matchingRange.returnClassPeriods * duePolicy.classPeriodMinutes));
    } else {
        dueDate.setMinutes(dueDate.getMinutes() + duePolicy.defaultSignoutMinutes);
    }

    return dueDate.toISOString();
}

const TIMEZONE_OPTIONS = [
    { value: 'America/Edmonton',     label: 'Mountain Time — Edmonton / Calgary' },
    { value: 'America/Vancouver',    label: 'Pacific Time — Vancouver / Victoria' },
    { value: 'America/Winnipeg',     label: 'Central Time — Winnipeg' },
    { value: 'America/Toronto',      label: 'Eastern Time — Toronto / Ottawa' },
    { value: 'America/Halifax',      label: 'Atlantic Time — Halifax' },
    { value: 'America/St_Johns',     label: "Newfoundland Time — St. John's" },
    { value: 'America/Los_Angeles',  label: 'Pacific Time — US West' },
    { value: 'America/Denver',       label: 'Mountain Time — US' },
    { value: 'America/Chicago',      label: 'Central Time — US' },
    { value: 'America/New_York',     label: 'Eastern Time — US' },
    { value: 'UTC',                  label: 'UTC' },
];

function buildTimezoneOptionsHtml(selectedTz) {
    return TIMEZONE_OPTIONS.map(tz =>
        `<option value="${tz.value}"${tz.value === selectedTz ? ' selected' : ''}>${tz.label}</option>`
    ).join('');
}

function buildPeriodRowHtml(start = '', end = '', returnClassPeriods = 1) {
    return `
        <div class="period-row" style="display:grid;grid-template-columns:1fr 1fr 110px 36px;gap:0.5rem;align-items:center;margin-bottom:0.5rem">
            <input type="time" class="form-control period-start" value="${start}" title="Period start time">
            <input type="time" class="form-control period-end" value="${end}" title="Period end time">
            <input type="number" class="form-control period-return-periods" min="1" value="${returnClassPeriods}" title="Number of class periods before item is due">
            <button type="button" class="btn btn-secondary remove-period-row-btn" style="padding:0.25rem 0.5rem" title="Remove period"><i class="ph ph-trash"></i></button>
        </div>`;
}

function buildPeriodRowsHtml(periodRanges) {
    return periodRanges.map(r => buildPeriodRowHtml(r.start, r.end, r.returnClassPeriods)).join('');
}

function collectPeriodRowsFromModal(containerId) {
    const rows = document.querySelectorAll(`#${containerId} .period-row`);
    const ranges = [];
    rows.forEach(row => {
        const start = row.querySelector('.period-start').value;
        const end = row.querySelector('.period-end').value;
        const returnClassPeriods = Math.max(1, parseInt(row.querySelector('.period-return-periods').value, 10) || 1);
        if (parseTimeToMinutes(start) !== null && parseTimeToMinutes(end) !== null) {
            ranges.push({ start, end, returnClassPeriods });
        }
    });
    return ranges;
}

function attachPeriodRowHandlers(containerId, addBtnId) {
    const container = document.getElementById(containerId);
    const addBtn = document.getElementById(addBtnId);
    if (container) {
        container.addEventListener('click', e => {
            const removeBtn = e.target.closest('.remove-period-row-btn');
            if (removeBtn) removeBtn.closest('.period-row').remove();
        });
    }
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (!container) return;
            const div = document.createElement('div');
            div.innerHTML = buildPeriodRowHtml('', '', 1);
            container.appendChild(div.firstElementChild);
        });
    }
}

function getStudentClassForUser(userId) {
    // Returns the first class — used for due-policy resolution (single-class context).
    return studentClasses.find(c => c.students.includes(userId));
}

// Returns ALL classes a student belongs to (a student can be in more than one).
function getStudentClassesForUser(userId) {
    return studentClasses.filter(c => c.students.includes(userId));
}

/*
 * MULTI-CLASS CONFLICT RESOLUTION
 * ─────────────────────────────────
 * If a student is enrolled in two classes that have different settings:
 *
 *  • Visible items  → UNION: an item is visible if it appears in ANY class's
 *                     visibleItemIds list.
 *  • Visibility tags → UNION: a tag is allowed if ANY of the student's classes
 *                     include it in allowedVisibilityTags, so the student sees
 *                     the most content they're entitled to.
 *  • Permissions    → MOST PERMISSIVE: a student gets a permission if ANY of
 *                     their classes (or their own stored perms) grants it.
 *                     E.g. Class A allows sign-out, Class B doesn't →
 *                     the student CAN sign out.
 *  • Due policy     → First enrolled class wins (lowest index in the array).
 *                     Admins should ensure classes that share students have
 *                     compatible due policies, or use per-student overrides.
 */
function getMergedPermissionsForStudent(user) {
    const classes = getStudentClassesForUser(user.id);
    if (classes.length === 0) return user.perms || { canCreateProjects: false, canJoinProjects: false, canSignOut: false };

    return {
        canCreateProjects: classes.some(c => c.defaultPermissions?.canCreateProjects) || (user.perms?.canCreateProjects ?? false),
        canJoinProjects:   classes.some(c => c.defaultPermissions?.canJoinProjects)   || (user.perms?.canJoinProjects   ?? false),
        canSignOut:        classes.some(c => c.defaultPermissions?.canSignOut)        || (user.perms?.canSignOut         ?? false)
    };
}

function getVisibleItemIdsForClass(cls) {
    if (!cls) return [];
    if (Array.isArray(cls.visibleItemIds)) return cls.visibleItemIds;
    return inventoryItems.map(item => item.id);
}

function getVisibleItemCountForClass(cls) {
    const allowed = new Set(cls?.allowedVisibilityTags || []);
    return inventoryItems.filter(item => {
        const itemTags = item.visibilityTags || [];
        if (itemTags.length === 0) return true;
        return itemTags.some(tag => allowed.has(tag));
    }).length;
}

function canUserSeeItem(user, item) {
    if (!user) return false;
    if (user.role !== 'student') return true;

    const classes = getStudentClassesForUser(user.id);
    if (classes.length === 0) return false;

    // Tag-only visibility model:
    // - Untagged items are visible to students in any class.
    // - Tagged items are visible if ANY class allows ANY matching tag.
    const itemTags = item.visibilityTags || [];
    if (itemTags.length === 0) return true;

    return classes.some(cls => {
        const allowed = cls.allowedVisibilityTags || [];
        return itemTags.some(tag => allowed.includes(tag));
    });
}

function applyVersionBadges() {
    const loginVersionEl = document.getElementById('app-version-login');
    if (loginVersionEl) {
        loginVersionEl.textContent = appVersion;
        loginVersionEl.style.display = appVersion ? '' : 'none';
    }
}

function applyBranding() {
    const title = `${appName} Inventory System`;
    const pageTitleEl = document.getElementById('app-page-title');
    if (pageTitleEl) pageTitleEl.textContent = title;
    document.title = title;

    const loginNameEl = document.getElementById('app-login-name');
    if (loginNameEl) loginNameEl.textContent = appName;

    const sidebarNameEl = document.getElementById('app-sidebar-name');
    if (sidebarNameEl) sidebarNameEl.textContent = appName;

    const loginSubtitleEl = document.getElementById('app-login-subtitle');
    if (loginSubtitleEl) loginSubtitleEl.textContent = appSubtitle;
}

function setRuntimeAppVersion(version) {
    const normalized = String(version || '').trim() || 'VERSION';
    appVersion = normalized;
    window.RUNTIME_APP_VERSION = normalized;
    applyVersionBadges();
}

function getSettingsSupabaseClient() {
    if (typeof dbClient !== 'undefined' && dbClient) return dbClient;

    const { SUPABASE_URL, SUPABASE_KEY } = envConfig;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function fetchKioskAppVersion(targetKioskId = kioskId) {
    const fallback = String(envConfig.APP_VERSION ?? envConfig.APP_Version ?? 'VERSION').trim() || 'VERSION';

    if (!targetKioskId) return fallback;

    const client = getSettingsSupabaseClient();
    if (!client) return fallback;

    try {
        const { data, error } = await client
            .from('kiosk_settings')
            .select('app_version')
            .eq('kiosk_id', targetKioskId)
            .maybeSingle();

        if (error) {
            console.warn('Failed to fetch kiosk app version:', error);
            return fallback;
        }

        return String(data?.app_version || '').trim() || fallback;
    } catch (error) {
        console.warn('Unexpected error fetching kiosk app version:', error);
        return fallback;
    }
}

function showNewUpdateOverlay(newVersion) {
    const existing = document.getElementById('app-update-overlay');
    if (existing) {
        const versionLabel = existing.querySelector('.app-update-version');
        if (versionLabel) versionLabel.textContent = newVersion;
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'app-update-overlay';
    overlay.className = 'app-update-overlay';
    overlay.innerHTML = `
        <div class="app-update-card glass-panel">
            <h3>New Update Available</h3>
            <p class="text-secondary" style="margin:0.5rem 0 1rem 0;">A new kiosk version is ready:</p>
            <p class="app-update-version" style="font-weight:700;color:var(--accent-secondary);margin-bottom:1rem">${newVersion}</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;">
                <button class="btn btn-secondary" id="dismiss-update-overlay">Later</button>
                <button class="btn btn-primary" id="apply-update-overlay">Reload Now</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('dismiss-update-overlay')?.addEventListener('click', () => {
        overlay.remove();
    });
    document.getElementById('apply-update-overlay')?.addEventListener('click', () => {
        window.location.reload();
    });
}

function handleRemoteAppVersionChange(nextVersion) {
    const normalized = String(nextVersion || '').trim();
    if (!normalized || normalized === appVersion) return;

    setRuntimeAppVersion(normalized);

    const action = String(envConfig.APP_UPDATE_ACTION || 'reload').trim().toLowerCase();
    if (action === 'overlay') {
        showNewUpdateOverlay(normalized);
        return;
    }

    window.location.reload();
}

function startKioskVersionRealtimeListener(targetKioskId = kioskId) {
    if (!targetKioskId) return;

    const client = getSettingsSupabaseClient();
    if (!client) return;

    if (kioskVersionChannel) {
        client.removeChannel(kioskVersionChannel);
        kioskVersionChannel = null;
    }

    kioskVersionChannel = client
        .channel(`kiosk-settings-version-${targetKioskId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'kiosk_settings',
            filter: `kiosk_id=eq.${targetKioskId}`
        }, payload => {
            handleRemoteAppVersionChange(payload?.new?.app_version);
        })
        .subscribe(status => {
            if (status === 'CHANNEL_ERROR') {
                console.warn('kiosk_settings app_version realtime channel error');
            }
        });
}

// Inventory Basket Logic
let inventoryBasket = [];
let isBasketOpen = false;

function toggleBasket(forceOpen = null) {
    isBasketOpen = forceOpen !== null ? forceOpen : !isBasketOpen;
    const panel = document.getElementById('basket-panel');
    if (isBasketOpen) {
        panel.classList.remove('hidden');
        renderBasket();
        // Pause timer is handled in the countdown logic check
    } else {
        panel.classList.add('hidden');
    }
}

function addToBasket(itemId) {
    if (currentUser.role === 'student' && !currentUser.perms?.canSignOut) {
        showToast('You do not have permission to sign out items.', 'error');
        return;
    }
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    if (currentUser.role === 'student' && !canUserSeeItem(currentUser, item)) {
        showToast('Your class level cannot access this item.', 'error');
        return;
    }

    if (item.stock <= 0) {
        showToast('Item is out of stock.', 'error');
        return;
    }

    const existing = inventoryBasket.find(b => b.id === itemId);
    if (existing) {
        if (existing.qty >= item.stock) {
            showToast('Cannot exceed available stock.', 'warning');
            return;
        }
        existing.qty++;
    } else {
        inventoryBasket.push({ id: item.id, name: item.name, qty: 1 });
    }

    showToast(`Added ${item.name} to basket`, 'success');
    renderBasket();
}

function removeFromBasket(itemId) {
    inventoryBasket = inventoryBasket.filter(b => b.id !== itemId);
    renderBasket();
}

function renderBasket() {
    const list = document.getElementById('basket-items-list');
    const countEl = document.getElementById('basket-count');
    const totalQtyEl = document.getElementById('basket-total-qty');
    const checkoutBtn = document.getElementById('checkout-basket-btn');
    const projSelect = document.getElementById('basket-project-select');

    countEl.textContent = inventoryBasket.length;

    if (inventoryBasket.length === 0) {
        list.innerHTML = `
            <div class="empty-basket-msg text-center py-8 opacity-50">
                <i class="ph ph-package" style="font-size: 3rem;"></i>
                <p>Your basket is empty</p>
            </div>`;
        totalQtyEl.textContent = '0';
        checkoutBtn.disabled = true;
    } else {
        list.innerHTML = inventoryBasket.map(item => `
            <div class="basket-item">
                <div class="flex-1">
                    <div class="font-bold text-sm">${item.name}</div>
                    <div class="text-xs text-muted">Quantity: ${item.qty}</div>
                </div>
                <button class="icon-btn text-danger" onclick="removeFromBasket('${item.id}')">
                    <i class="ph ph-minus-circle"></i>
                </button>
            </div>
        `).join('');

        const total = inventoryBasket.reduce((sum, item) => sum + item.qty, 0);
        totalQtyEl.textContent = total;
        checkoutBtn.disabled = false;
    }

    // Populate projects
    const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
    projSelect.innerHTML = '<option value="">Personal Sign-out</option>' +
        myProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function formatItemExtraInfo(item) {
    if (!item) {
        return {
            location: 'Unknown',
            description: 'No description available.'
        };
    }

    return {
        location: String(item.location || item.storageLocation || item.bin || 'Not set'),
        description: String(item.description || item.notes || 'No description available.')
    };
}

function isMetadataBlank(value) {
    return value === undefined || value === null || String(value).trim() === '';
}

function getMissingItemMetadataFields(item) {
    if (!item) return ['location', 'description'];

    const locationMissing = isMetadataBlank(item.location) && isMetadataBlank(item.storageLocation) && isMetadataBlank(item.bin);
    const descriptionMissing = isMetadataBlank(item.description) && isMetadataBlank(item.notes);

    const missing = [];
    if (locationMissing) missing.push('location');
    if (descriptionMissing) missing.push('description');
    return missing;
}

function renderMissingMetadataIcon(item) {
    return '';
}

async function requestDoorUnlockAndLogAccess({ actionType, item, quantity = 1, projectName = 'Personal' }) {
    const actorId = currentUser?.id || 'SYSTEM';
    const actorRole = currentUser?.role || 'system';
    const itemName = item?.name || 'Unknown Item';
    const itemId = item?.id || 'Unknown ID';

    try {
        await fetch('http://localhost:8080/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                itemId: item?.id,
                itemName: item?.name,
                category: item?.category,
                actionType,
                userId: actorId,
                quantity,
                projectName
            })
        });

        addLog(actorId, 'Door Access', `Door unlocked for student ${actionType}: ${quantity}x ${itemName} (${itemId}) in ${projectName} [role=${actorRole}]`);
        return true;
    } catch (err) {
        addLog(actorId, 'Door Access Failed', `Door unlock failed during ${actionType}: ${quantity}x ${itemName} (${itemId}) in ${projectName}. Error: ${err.message || err}`);
        showToast('Warning: Hardware unlock script unreachable.', 'warning');
        return false;
    }
}

function openCheckoutReviewModal() {
    if (inventoryBasket.length === 0) {
        showToast('Your basket is empty.', 'error');
        return;
    }

    const projectSelect = document.getElementById('basket-project-select');
    const selectedProjectId = projectSelect?.value || '';
    const selectedProject = selectedProjectId
        ? projects.find(p => p.id === selectedProjectId)
        : getOrCreatePersonalProject(currentUser.id);

    const destinationName = selectedProjectId
        ? (selectedProject ? selectedProject.name : 'Unknown Project')
        : 'Personal Sign-out';

    const projectedDueDate = new Date(calculateDueDate(new Date(), currentUser));

    const rows = inventoryBasket.map(entry => {
        const item = inventoryItems.find(i => i.id === entry.id);
        const info = formatItemExtraInfo(item);

        return `
            <div class="glass-panel" style="padding:0.85rem;margin-bottom:0.6rem;border-radius:var(--radius-sm)">
                <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
                    <div>
                        <div class="font-bold">${item ? item.name : entry.name} (x${entry.qty})</div>
                        <small class="text-muted">SKU: ${item?.sku || 'N/A'} | Category: ${item?.category || 'N/A'}</small>
                    </div>
                    <span class="badge" style="background:rgba(245,158,11,0.2);color:var(--warning)">Stock: ${item?.stock ?? 'N/A'}</span>
                </div>
                <div style="margin-top:0.45rem">
                    <small><strong>Location:</strong> ${info.location}</small><br>
                    <small><strong>Description:</strong> ${info.description}</small>
                </div>
            </div>
        `;
    }).join('');

    const totalQty = inventoryBasket.reduce((sum, i) => sum + i.qty, 0);

    const html = `
        <div class="modal-header">
            <h3>Confirm Checkout</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary" style="margin-bottom:0.8rem">
                Review items before checkout.
            </p>
            <div class="glass-panel" style="padding:0.75rem;margin-bottom:0.8rem;border-radius:var(--radius-sm)">
                <div><strong>Destination:</strong> ${destinationName}</div>
                <div><strong>Total Quantity:</strong> ${totalQty}</div>
                <div><strong>Due Date (preview):</strong> ${projectedDueDate.toLocaleString()}</div>
            </div>
            ${rows}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-basket-checkout-final">Confirm Checkout</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-basket-checkout-final')?.addEventListener('click', async () => {
        closeModal();
        await checkoutBasket();
    });
}

function getOrCreatePersonalProject(userId) {
    const personalId = `PERS-${userId}`;
    let personalProject = projects.find(p => p.id === personalId);
    if (!personalProject) {
        personalProject = {
            id: personalId,
            name: 'Personal Use',
            ownerId: userId,
            collaborators: [],
            itemsOut: [],
            status: 'Active'
        };
        projects.push(personalProject);
    }
    return personalProject;
}

// Global checkout function
async function checkoutBasket() {
    if (inventoryBasket.length === 0) {
        showToast('Your basket is empty.', 'error');
        return;
    }

    const projectId = document.getElementById('basket-project-select').value;
    const project = projectId ? projects.find(p => p.id === projectId) : getOrCreatePersonalProject(currentUser.id);

    if (!project) {
        showToast('Unable to resolve checkout destination project.', 'error');
        return;
    }

    if (project.id.startsWith('PERS-')) {
        const ensured = await ensureProjectExistsInSupabase(project);
        if (!ensured) {
            showToast('Failed to create personal project in Supabase.', 'error');
            return;
        }
    }

    if (currentUser?.role === 'student') {
        const firstBasketItem = inventoryBasket[0];
        const firstItem = inventoryItems.find(i => i.id === firstBasketItem?.id);
        const totalQty = inventoryBasket.reduce((sum, entry) => sum + entry.qty, 0);

        const unlocked = await requestDoorUnlockAndLogAccess({
            actionType: 'sign-out',
            item: firstItem,
            quantity: totalQty,
            projectName: project?.name || 'Personal'
        });

        if (!unlocked) {
            showToast('Door unlock denied. Checkout canceled.', 'error');
            return;
        }
    }

    for (const basketItem of inventoryBasket) {
        const item = inventoryItems.find(i => i.id === basketItem.id);
        if (!item) {
            showToast('Checkout failed: one or more items no longer exist.', 'error');
            return;
        }
        if (basketItem.qty <= 0 || basketItem.qty > item.stock) {
            showToast(`Checkout failed: invalid quantity for ${item.name}.`, 'error');
            return;
        }
    }

    for (const basketItem of inventoryBasket) {
        const item = inventoryItems.find(i => i.id === basketItem.id);
        if (item) {
            item.stock -= basketItem.qty;
            
            // Update stock in Supabase
            await updateItemInSupabase(item.id, { stock: item.stock }).catch(err => {
                console.error('Failed to update item stock in Supabase:', err);
            });
            
            _trackItemSignout(item, basketItem.qty);

            const signoutData = {
                id: generateId('OUT'),
                itemId: item.id,
                quantity: basketItem.qty,
                signoutDate: new Date().toISOString(),
                dueDate: calculateDueDate(new Date(), currentUser),
                assignedToUserId: project.ownerId,
                signedOutByUserId: currentUser.id
            };

            project.itemsOut.push(signoutData);
            
            // Save project item out to Supabase
            await addProjectItemOutToSupabase({
                projectId: project.id,
                itemId: item.id,
                quantity: basketItem.qty,
                signoutDate: signoutData.signoutDate,
                dueDate: signoutData.dueDate
            }).catch(err => {
                console.error('Failed to save project item out to Supabase:', err);
            });

            if (project.id.startsWith('PERS-')) {
                addLog(currentUser.id, 'Personal Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} to self`);
            } else {
                addLog(currentUser.id, 'Project Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} for project ${project.name}`);
            }
        }
    }

    inventoryBasket = [];
    showToast('Bulk checkout complete!', 'success');
    toggleBasket(false);
    renderInventory();
    renderDashboard();
    renderProjects();
}

// Event Listeners for Basket
document.getElementById('open-basket-btn')?.addEventListener('click', () => toggleBasket(true));
document.getElementById('close-basket-btn')?.addEventListener('click', () => toggleBasket(false));
document.getElementById('checkout-basket-btn')?.addEventListener('click', openCheckoutReviewModal);

// Init application
document.addEventListener('DOMContentLoaded', async () => {
    applyBranding();

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        showToast('Supabase client library failed to load. Check internet/CDN access and reload.', 'error');
        return;
    }

    if (!window.APP_ENV || !window.APP_ENV.SUPABASE_URL) {
        showToast('env.js failed to load or APP_ENV is missing. Check that env.js is present and accessible.', 'error');
        return;
    }

    if (typeof loadAllData !== 'function') {
        showToast('data.js failed to load. Check browser console for script errors, then reload.', 'error');
        return;
    }

    // Load all data from Supabase tables before initializing the app
    try {
        await loadAllData();
    } catch (error) {
        console.error('Initial Supabase load failed:', error);
        showToast('Unable to load data from Supabase. Login may not work until this is fixed.', 'error');
    }
    
    // Pull kiosk app version from Supabase at startup and keep in global state.
    const remoteVersion = await fetchKioskAppVersion(kioskId);
    setRuntimeAppVersion(remoteVersion);
    startKioskVersionRealtimeListener(kioskId);

    // Bring focus to barcode scanner input
    if (barcodeInput) {
        barcodeInput.focus();
        document.addEventListener('click', () => {
            if (!currentUser && !loginView.classList.contains('hidden')) {
                barcodeInput.focus();
            }
        });
    }

    // Interaction listeners for inactivity reset
    ['mousemove', 'keydown', 'mousedown', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetInactivityTimer, true);
    });
});

/* =======================================
   LOGIN & HELP LOGIC
   ======================================= */
// Help toggles
showHelpBtn?.addEventListener('click', () => {
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.classList.add('hidden');
        loginHelpView.classList.remove('hidden');
        setTimeout(() => loginHelpView.classList.add('active'), 50);
    }, 300);
});

backToLoginBtn?.addEventListener('click', () => {
    loginHelpView.classList.remove('active');
    setTimeout(() => {
        loginHelpView.classList.add('hidden');
        loginView.classList.remove('hidden');
        setTimeout(() => {
            loginView.classList.add('active');
            barcodeInput.focus();
        }, 50);
    }, 300);
});

submitHelpBtn?.addEventListener('click', async () => {
    const name = document.getElementById('help-name').value.trim();
    const email = document.getElementById('help-email').value.trim();
    const desc = document.getElementById('help-desc').value.trim();

    if (!name || !desc) {
        showToast('Name and issue description are required.', 'error');
        return;
    }

    const helpRequest = {
        id: generateId('REQ'),
        name: name,
        email: email,
        description: desc,
        status: 'Pending',
        timestamp: new Date().toISOString()
    };

    // Add to local array
    helpRequests.unshift(helpRequest);
    
    // Save to Supabase
    const saved = await addHelpRequestToSupabase(helpRequest);
    if (!saved) {
        showToast('Failed to submit request. Please try again.', 'error');
        helpRequests.shift(); // Remove from local array if save failed
        return;
    }

    showToast('Your request has been submitted. Support will contact you shortly.', 'success');
    document.getElementById('help-name').value = '';
    document.getElementById('help-email').value = '';
    document.getElementById('help-desc').value = '';
    backToLoginBtn.click();
});

async function handleBarcodeLogin(rawId) {
    const id = String(rawId || '').trim().toUpperCase();
    barcodeInput.value = '';

    if (!id) {
        showToast('Enter or scan a user ID or Item Barcode.', 'error');
        return;
    }

    // --- INTERCEPT SIGNED OUT ITEM SCANS ---
    const scannedItem = inventoryItems.find(i => i.id === id || i.sku === id);
    if (scannedItem) {
        let signedOutRecord = null;
        for (const p of projects) {
            const found = p.itemsOut.find(io => io.itemId === scannedItem.id);
            if (found) {
                signedOutRecord = { ...found, projectName: p.name };
                break;
            }
        }
        
        if (signedOutRecord) {
            showHardwareReturnModal(scannedItem, signedOutRecord);
            return;
        }
    }
    // ---------------------------------------

    if (typeof fetchUserByIdFromSupabase !== 'function') {
        showToast('Supabase data module is not loaded. Refresh and verify script loading.', 'error');
        return;
    }

    if (!checkLoginRateLimit()) return;

    try {
        const user = await fetchUserByIdFromSupabase(id);
        if (user) {
            if (user.status === 'Suspended' && !isSuspensionBypassedUser(user)) {
                showToast('Your account is suspended. Please contact a teacher.', 'error');
                return;
            }

            if (user.status === 'Suspended' && isSuspensionBypassedUser(user)) {
                user.status = 'Active';
                updateUserInSupabase(user.id, { status: 'Active' }).catch(err => {
                    console.warn('Failed to auto-reactivate suspension-bypassed developer user:', err);
                });
            }
            clearFailedLoginAttempts();
            try {
                login(user);
            } catch (loginError) {
                console.error('Login transition failed:', loginError);
                showToast('Login succeeded but dashboard failed to load.', 'error');
            }
            return;
        }

        recordFailedLoginAttempt();
        showToast('Invalid barcode scanned.', 'error');
    } catch (error) {
        console.error('Login lookup failed:', error);
        showToast('Database lookup failed during login.', 'error');
    }
}

function showHardwareReturnModal(item, record) {
    const html = `
        <div class="modal-header">
            <h3>Return ${item.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body" style="text-align:center;">
            <i class="ph ph-lock-key-open text-primary" style="font-size:4rem;margin-bottom:1rem;"></i>
            <p style="font-size:1.1rem;margin-bottom:1rem;">Returning to <strong>${item.category}</strong></p>
            <p class="text-muted mb-4">Click below to unlock the hardware cabinet and complete the return for project: ${record.projectName}.</p>
            <button class="btn btn-primary" id="hardware-unlock-return-btn" style="width:100%;font-size:1.2rem;padding:0.75rem;"><i class="ph ph-power"></i> Unlock Door & Return</button>
        </div>
    `;
    openModal(html);

    document.getElementById('hardware-unlock-return-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Processing...';

        const unlocked = await requestDoorUnlockAndLogAccess({
            actionType: 'sign-in',
            item,
            quantity: 1,
            projectName: record.projectName || 'Personal'
        });

        if (!unlocked) {
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-power"></i> Try Again';
            return;
        }

        const returned = await returnItemToSupabase(record.id);
        if (!returned) {
            showToast('Failed to return item in database.', 'error');
            btn.disabled = false;
            btn.innerHTML = '<i class="ph ph-power"></i> Try Again';
            return;
        }

        await Promise.all([
            refreshProjectsFromSupabase(),
            refreshInventoryFromSupabase()
        ]);

        showToast(`Successfully returned ${item.name}!`, 'success');
        addLog('SYSTEM', 'Return Item', `Hardware Return: ${item.name} from ${record.projectName}`);
        closeModal();
        if (currentUser) renderDashboard();
    });
}

barcodeInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        e.preventDefault();
        await handleBarcodeLogin(barcodeInput.value);
    }
});

document.addEventListener('keydown', async (e) => {
    if (currentUser) return;
    if (loginView.classList.contains('hidden')) return;
    if (loginHelpView && !loginHelpView.classList.contains('hidden')) return;
    if (document.activeElement === barcodeInput) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        e.preventDefault();
        await handleBarcodeLogin(barcodeInput.value);
        return;
    }

    if (e.key === 'Backspace') {
        e.preventDefault();
        barcodeInput.value = barcodeInput.value.slice(0, -1);
        return;
    }

    if (e.key.length === 1) {
        barcodeInput.value += e.key;
    }
});

// Enforce focus on barcode input when clicking anywhere on the login view (except buttons)
document.getElementById('login-view')?.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) {
        barcodeInput.focus();
    }
});

function getRoleIcon(role) {
    if (role === 'student') return '<i class="ph-fill ph-graduation-cap"></i>';
    if (role === 'teacher') return '<i class="ph-fill ph-pencil"></i>';
    if (role === 'developer') return '<i class="ph-fill ph-code"></i>';
    return '<i class="ph-fill ph-user"></i>';
}

function canCurrentUserViewOrders() {
    if (!currentUser) return false;
    if (currentUser.role === 'student') return ordersStudentViewEnabled;
    return true;
}

function isSuspensionBypassedUser(user) {
    if (!user || user.role !== 'developer') return false;
    const normalizedId = String(user.id || '').trim().toUpperCase();
    const normalizedName = String(user.name || '').trim().toUpperCase();
    return normalizedId === 'W.OEHLERKING' || normalizedName === 'W.OEHLERKING';
}

function persistOrdersStudentViewSetting(value) {
    ordersStudentViewEnabled = !!value;
    localStorage.setItem(ordersStudentViewStorageKey, String(ordersStudentViewEnabled));
}

function applyOrdersNavVisibility() {
    if (!navOrders) return;
    if (canCurrentUserViewOrders()) navOrders.classList.remove('hidden');
    else navOrders.classList.add('hidden');
}

function login(user) {
    currentUser = user;
    _trackLogin();
    startCountdown();
    
    // Log the login event
    addLog(user.id, 'User Login', `${user.name} (${user.role}) logged in`);

    // Update Profile UI
    const profileAvatar = document.getElementById('user-avatar');
    if (profileAvatar) profileAvatar.innerHTML = getRoleIcon(user.role);

    userNameEl.textContent = user.name;
    userRoleEl.textContent = user.role;

    // Student Class Visibility
    const userClassEl = document.getElementById('user-class');
    if (user.role === 'student') {
        const userClasses = getStudentClassesForUser(user.id);
        if (userClassEl) {
            userClassEl.textContent = userClasses.length > 0
                ? userClasses.map(c => c.name).join(', ')
                : 'No Class Assigned';
            userClassEl.classList.remove('hidden');
        }
    } else {
        if (userClassEl) userClassEl.classList.add('hidden');
    }

    // Set role badge color
    if (user.role === 'developer') userRoleEl.style.color = '#8b5cf6';
    else if (user.role === 'teacher') userRoleEl.style.color = '#f59e0b';
    else userRoleEl.style.color = '#94a3b8';

    // Access Control & Permission Enforcement
    const navRequests = document.getElementById('nav-requests');
    if (user.role === 'student') {
        navLogs.classList.add('hidden');
        navUsers.classList.add('hidden');
        navClasses.classList.add('hidden');
        navMyItems?.classList.remove('hidden');
        navRequests?.classList.add('hidden');
        applyOrdersNavVisibility();
        document.getElementById('manage-categories-btn')?.classList.add('hidden');
        document.getElementById('manage-visibility-tags-btn')?.classList.add('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.add('hidden');
    } else {
        navLogs.classList.remove('hidden');
        navUsers.classList.remove('hidden');
        navClasses.classList.remove('hidden');
        navMyItems?.classList.add('hidden');
        navRequests?.classList.remove('hidden');
        applyOrdersNavVisibility();
        document.getElementById('manage-categories-btn')?.classList.remove('hidden');
        document.getElementById('manage-visibility-tags-btn')?.classList.remove('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.remove('hidden');
    }

    // Role-based Add Item / Create Project UI logic
    const addItemBtn = document.getElementById('add-item-btn');
    const createProjectBtn = document.getElementById('create-project-btn');
    const createClassBtn = document.getElementById('create-class-btn');

    if (user.role === 'student') {
        addItemBtn?.classList.add('hidden');
        if (!user.perms?.canCreateProjects) {
            createProjectBtn?.classList.add('hidden');
        } else {
            createProjectBtn?.classList.remove('hidden');
        }
    } else {
        addItemBtn?.classList.remove('hidden');
        createProjectBtn?.classList.remove('hidden');
    }

    if (user.role === 'teacher' || user.role === 'developer') createClassBtn?.classList.remove('hidden');
    else createClassBtn?.classList.add('hidden');

    showToast(`Welcome, ${user.name}`);

    // Switch Views
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.classList.add('hidden');
        mainView.classList.remove('hidden');
        setTimeout(() => mainView.classList.add('active'), 50);

        // Load initial Dashboard from fresh Supabase state
        switchPage('dashboard', 'Dashboard').catch(err => console.error(err));
    }, 300);
}

function logout(message = 'Logged out successfully') {
    if (!currentUser) {
        showToast(message);
        return;
    }

    _trackLogout();
    currentUser = null;
    inventoryBasket = [];
    clearInterval(countdownInterval);
    mainView.classList.remove('active');
    setTimeout(() => {
        mainView.classList.add('hidden');
        loginView.classList.remove('hidden');
        setTimeout(() => {
            loginView.classList.add('active');
            barcodeInput.focus();
        }, 50);
    }, 300);
    showToast(message);
}

function returnToLoginView(options = {}) {
    const message = options.message || 'Logged out successfully';
    const showMessage = options.showMessage !== false;

    if (currentUser) _trackLogout();
    currentUser = null;
    inventoryBasket = [];
    clearInterval(countdownInterval);

    mainView.classList.remove('active');
    loginHelpView.classList.remove('active');

    setTimeout(() => {
        mainView.classList.add('hidden');
        loginHelpView.classList.add('hidden');
        loginView.classList.remove('hidden');
        setTimeout(() => {
            loginView.classList.add('active');
            barcodeInput.focus();
        }, 50);
    }, 300);

    if (showMessage) showToast(message);
}

logoutBtn.addEventListener('click', () => logout());

/* =======================================
   ROUTING
   ======================================= */
navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const target = btn.getAttribute('data-target');
        const title = btn.textContent.trim();

        // UI Selection
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        await switchPage(target, title);
    });
});

async function refreshPageDataFromSupabase(targetId) {
    if (targetId === 'dashboard') {
        await loadAllData();
        return;
    }

    if (targetId === 'inventory') {
        await Promise.all([
            refreshInventoryFromSupabase(),
            loadCategories(),
            loadVisibilityTags()
        ]);
        return;
    }

    if (targetId === 'projects') {
        await Promise.all([
            refreshProjectsFromSupabase(),
            refreshUsersFromSupabase(),
            refreshInventoryFromSupabase()
        ]);
        return;
    }

    if (targetId === 'my-items') {
        await Promise.all([
            refreshProjectsFromSupabase(),
            refreshInventoryFromSupabase()
        ]);
        return;
    }

    if (targetId === 'logs') {
        await Promise.all([
            loadActivityLogs(),
            refreshUsersFromSupabase()
        ]);
        return;
    }

    if (targetId === 'users') {
        await refreshUsersFromSupabase();
        return;
    }

    if (targetId === 'classes') {
        await Promise.all([
            loadStudentClasses(),
            refreshUsersFromSupabase(),
            refreshInventoryFromSupabase(),
            loadVisibilityTags()
        ]);
        return;
    }

    if (targetId === 'requests') {
        await Promise.all([
            refreshRequestsFromSupabase(),
            refreshProjectsFromSupabase(),
            refreshUsersFromSupabase(),
            refreshInventoryFromSupabase()
        ]);
        return;
    }

    if (targetId === 'orders') {
        await Promise.all([
            refreshRequestsFromSupabase(),
            refreshUsersFromSupabase()
        ]);
    }
}

async function switchPage(targetId, title) {
    if (targetId === 'orders' && !canCurrentUserViewOrders()) {
        showToast('Orders view is disabled for students.', 'error');
        return;
    }

    _trackPageVisit(targetId);
    pageTitle.textContent = title;

    try {
        await refreshPageDataFromSupabase(targetId);
    } catch (error) {
        console.error(`Failed to refresh ${targetId} from Supabase:`, error);
        showToast(`Failed to refresh ${title} from Supabase. Showing current data.`, 'error');
    }

    pages.forEach(page => {
        page.classList.remove('active');
        page.classList.add('hidden');
    });

    const targetPage = document.getElementById(`page-${targetId}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        // trigger reflow for animation
        void targetPage.offsetWidth;
        targetPage.classList.add('active');
    }

    // Call data load functions based on page
    if (targetId === 'dashboard') loadDashboard();
    if (targetId === 'inventory') renderInventory();
    if (targetId === 'projects') renderProjects();
    if (targetId === 'my-items') renderMyItems();
    if (targetId === 'logs') renderLogs();
    if (targetId === 'users') renderUsers();
    if (targetId === 'classes') renderClasses();
    if (targetId === 'requests') renderRequests();
    if (targetId === 'orders') renderOrders();
}

function renderMyItems() {
    const tbody = document.getElementById('my-items-table-body');
    if (!tbody) return;

    if (!currentUser || currentUser.role !== 'student') {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">This page is available to students only.</td></tr>';
        return;
    }

    // Get all projects where current user is owner or collaborator
    const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));

    // Collect all items from personal and project sign-outs
    const allItems = [];
    
    myProjects.forEach(proj => {
        (proj.itemsOut || []).forEach(io => {
            const item = inventoryItems.find(i => i.id === io.itemId);
            allItems.push({
                itemName: item ? item.name : io.itemId,
                quantity: io.quantity,
                signoutDate: io.signoutDate,
                dueDate: io.dueDate,
                projectName: proj.name === 'Personal Use' ? '(Personal)' : proj.name
            });
        });
    });

    // Sort by due date (overdue first, then by date)
    allItems.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    if (allItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No items signed out right now.</td></tr>';
        return;
    }

    tbody.innerHTML = allItems.map(entry => {
        const due = new Date(entry.dueDate);
        const isOverdue = due < new Date();
        const statusStyle = isOverdue
            ? 'background:rgba(239,68,68,0.2);color:var(--danger)'
            : 'background:rgba(245,158,11,0.2);color:var(--warning)';

        return `
            <tr>
                <td><strong>${entry.itemName}</strong></td>
                <td>${entry.quantity}</td>
                <td><small class="text-muted">${entry.projectName}</small></td>
                <td><small class="text-muted">${new Date(entry.signoutDate).toLocaleString()}</small></td>
                <td><span class="badge" style="${statusStyle}">${isOverdue ? 'Overdue' : 'Signed Out'}</span></td>
            </tr>
        `;
    }).join('');
}

/* =======================================
   DASHBOARD LOGIC
   ======================================= */
function loadDashboard() {
    const statsContainer = document.getElementById('dashboard-stats');
    const studentWidgets = document.getElementById('student-dashboard-widgets');
    const tabbedWidget = document.getElementById('dashboard-tabbed-widget');
    const list1 = document.getElementById('low-stock-list');
    const list2 = document.getElementById('recent-activity-mini');
    const now = new Date();

    if (currentUser.role === 'student') {
        // Student Dashboard view
        if (tabbedWidget) tabbedWidget.parentElement.style.display = 'none';
        if (studentWidgets) studentWidgets.style.display = '';

        const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
        let itemsOutCount = 0;
        let dueBackCount = 0;
        let myItemsOut = [];

        myProjects.forEach(p => {
            p.itemsOut.forEach(outItem => {
                itemsOutCount += outItem.quantity;
                if (outItem.dueDate && new Date(outItem.dueDate) <= now) {
                    dueBackCount += outItem.quantity;
                }
                myItemsOut.push({ ...outItem, projectName: p.name });
            });
        });

        statsContainer.innerHTML = `
            <div class="stat-card glass-panel">
                <div class="stat-icon primary"><i class="ph ph-folder-open"></i></div>
                <div class="stat-details">
                    <h4>Active Projects</h4>
                    <p>${myProjects.length}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon warning"><i class="ph ph-package"></i></div>
                <div class="stat-details">
                    <h4>Items Signed Out</h4>
                    <p>${itemsOutCount}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon" style="background:rgba(239,68,68,0.15);color:var(--danger)"><i class="ph ph-timer"></i></div>
                <div class="stat-details">
                    <h4>Due Back Now</h4>
                    <p>${dueBackCount}</p>
                </div>
            </div>
        `;

        list1.innerHTML = myItemsOut.length === 0 ? '<p class="text-muted">No items currently signed out.</p>' :
            myItemsOut.map((io, idx) => {
                const item = inventoryItems.find(i => i.id === io.itemId);
                const isOverdue = new Date(io.dueDate) < new Date();
                return `
                <li class="stock-item">
                    <div>
                        <strong>${item ? item.name : 'Unknown Item'} (x${io.quantity})</strong>
                        <span class="text-muted block text-sm">Project: ${io.projectName}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.75rem">
                        <span class="${isOverdue ? 'text-danger' : 'text-warning'} font-bold text-sm">
                            ${isOverdue ? 'Overdue!' : 'Due: ' + new Date(io.dueDate).toLocaleDateString()}
                        </span>
                        <button class="btn btn-secondary text-sm request-extension-btn" data-item-id="${io.itemId}" data-project="${io.projectName}" data-due="${io.dueDate}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">
                            <i class="ph ph-clock-clockwise"></i> Extend
                        </button>
                        <button class="btn btn-primary text-sm return-item-btn" data-project-item-out-id="${io.id}" data-item-id="${io.itemId}" data-project="${io.projectName}" style="padding:0.3rem 0.6rem;font-size:0.75rem;margin-left:0.5rem">
                            <i class="ph ph-arrow-u-down-left"></i> Return
                        </button>
                    </div>
                </li>`;
            }).join('');

        // Bind extension request buttons
        document.querySelectorAll('.request-extension-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const itemId = e.currentTarget.getAttribute('data-item-id');
                const projectName = e.currentTarget.getAttribute('data-project');
                const currentDue = e.currentTarget.getAttribute('data-due');
                const item = inventoryItems.find(i => i.id === itemId);

                const request = {
                    id: generateId('EXT'),
                    userId: currentUser.id,
                    userName: currentUser.name,
                    itemId: itemId,
                    itemName: item ? item.name : 'Unknown',
                    projectName: projectName,
                    currentDue: currentDue,
                    requestedDue: new Date(new Date(currentDue).getTime() + 86400000 * 7).toISOString(),
                    status: 'Pending',
                    timestamp: new Date().toISOString()
                };

                const created = await addExtensionRequestToSupabase(request);
                if (!created) {
                    showToast('Failed to submit extension request to Supabase.', 'error');
                    return;
                }

                await refreshRequestsFromSupabase();

                showToast(`Extension requested for ${item ? item.name : 'item'}. An admin will review it.`, 'success');
                addLog(currentUser.id, 'Extension Request', `Requested extension for ${item ? item.name : itemId} in ${projectName}`);
            });
        });

        // Bind return item buttons
        document.querySelectorAll('.return-item-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const projectItemOutId = e.currentTarget.getAttribute('data-project-item-out-id');
                const itemId = e.currentTarget.getAttribute('data-item-id');
                const projectName = e.currentTarget.getAttribute('data-project');
                const item = inventoryItems.find(i => i.id === itemId);

                if (!confirm(`Are you sure you want to return ${item ? item.name : 'this item'} to ${projectName}?`)) return;

                if (currentUser?.role === 'student') {
                    const unlocked = await requestDoorUnlockAndLogAccess({
                        actionType: 'sign-in',
                        item,
                        quantity: 1,
                        projectName
                    });

                    if (!unlocked) {
                        showToast('Door unlock denied. Return canceled.', 'error');
                        return;
                    }
                }

                const returned = await returnItemToSupabase(projectItemOutId);
                if (!returned) {
                    showToast('Failed to return item. Please try again.', 'error');
                    return;
                }

                await Promise.all([
                    refreshProjectsFromSupabase(),
                    refreshInventoryFromSupabase()
                ]);

                showToast(`Successfully returned ${item ? item.name : ''}.`, 'success');
                addLog(currentUser.id, 'Return Item', `Returned ${item ? item.name : itemId} from ${projectName}`);
                renderDashboard();
            });
        });

        list2.innerHTML = myProjects.length === 0 ? '<p class="text-muted">You are not in any projects.</p>' :
            myProjects.slice(0, 6).map(p => {
                const projectOut = p.itemsOut.reduce((acc, io) => acc + io.quantity, 0);
                const projectDue = p.itemsOut.reduce((acc, io) => acc + ((io.dueDate && new Date(io.dueDate) <= now) ? io.quantity : 0), 0);
                return `
                <li class="activity-item">
                    <div class="timestamp">${p.status}</div>
                    <div><strong>${p.name}</strong> · Out: ${projectOut} · Due: ${projectDue}</div>
                    <div style="display:flex;gap:0.5rem;margin-top:0.55rem;">
                        <button class="btn btn-secondary text-sm dashboard-project-open-btn" data-project-id="${p.id}" style="padding:0.3rem 0.55rem;font-size:0.75rem;">
                            <i class="ph ph-folder-open"></i> Open
                        </button>
                        <button class="btn btn-primary text-sm dashboard-project-items-btn" data-project-id="${p.id}" style="padding:0.3rem 0.55rem;font-size:0.75rem;">
                            <i class="ph ph-list"></i> Items
                        </button>
                    </div>
                </li>
            `;
            }).join('');

        wireDashboardProjectSummaryActions(document);

    } else {
        // Admin/Teacher Dashboard view
        if (tabbedWidget) tabbedWidget.parentElement.style.display = '';
        if (studentWidgets) studentWidgets.style.display = 'none';

        const totalItems = inventoryItems.length;
        const lowStockCount = inventoryItems.filter(i => i.stock <= i.threshold && i.item_type !== 'consumable').length;
        const totalStock = inventoryItems.reduce((acc, curr) => acc + curr.stock, 0);

        // Count items signed out across all projects
        let totalItemsOut = 0;
        let totalItemsDue = 0;
        projects.forEach(p => {
            p.itemsOut.forEach(io => {
                totalItemsOut += io.quantity;
                if (io.dueDate && new Date(io.dueDate) <= now) {
                    totalItemsDue += io.quantity;
                }
            });
        });

        statsContainer.innerHTML = `
            <div class="stat-card glass-panel">
                <div class="stat-icon primary"><i class="ph ph-package"></i></div>
                <div class="stat-details">
                    <h4>Total Unique Items</h4>
                    <p>${totalItems}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon warning"><i class="ph ph-warning-circle"></i></div>
                <div class="stat-details">
                    <h4>Low Stock Alerts</h4>
                    <p>${lowStockCount}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon secondary"><i class="ph ph-stack"></i></div>
                <div class="stat-details">
                    <h4>Total Inventory Units</h4>
                    <p>${totalStock}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon" style="background:rgba(239,68,68,0.15);color:var(--danger)"><i class="ph ph-export"></i></div>
                <div class="stat-details">
                    <h4>Items Signed Out</h4>
                    <p>${totalItemsOut}</p>
                </div>
            </div>
            <div class="stat-card glass-panel">
                <div class="stat-icon" style="background:rgba(239,68,68,0.15);color:var(--danger)"><i class="ph ph-timer"></i></div>
                <div class="stat-details">
                    <h4>Due Back Now</h4>
                    <p>${totalItemsDue}</p>
                </div>
            </div>
        `;

        // Setup tabbed widget
        function renderAdminTab(tab) {
            const tabContent = document.getElementById('widget-tab-content');
            if (!tabContent) return;

            if (tab === 'lowstock') {
                const lowStockItems = inventoryItems.filter(i => i.stock <= i.threshold && i.item_type !== 'consumable').slice(0, 8);
                tabContent.innerHTML = `<ul class="stock-list">${lowStockItems.map(item => `
                    <li class="stock-item">
                        <div>
                            <strong>${item.name}</strong>
                            <span class="text-muted block text-sm">SKU: ${item.sku}</span>
                        </div>
                        <span class="text-danger font-bold">${item.stock} left</span>
                    </li>
                `).join('') || '<p class="text-muted">All stock levels are healthy.</p>'}</ul>`;
            } else if (tab === 'activity') {
                const recentLogs = activityLogs.slice(0, 8);
                tabContent.innerHTML = `<ul class="activity-list mini">${recentLogs.map(log => {
                    const user = mockUsers.find(u => u.id === log.userId);
                    const displayName = user?.name || (log.userId === 'SYSTEM' ? 'SYSTEM' : log.userId) || 'Unknown';
                    return `
                    <li class="activity-item">
                        <div class="timestamp">${new Date(log.timestamp).toLocaleString()}</div>
                        <div><span style="font-size:1rem;margin-right:0.3rem">${user?.role ? getRoleIcon(user.role) : '👤'}</span><strong>${displayName}</strong> - ${log.action}</div>
                    </li>
                `;
                }).join('')}</ul>`;
            } else if (tab === 'itemsout') {
                let allItemsOut = [];
                projects.forEach(p => {
                    p.itemsOut.forEach(io => {
                        const item = inventoryItems.find(i => i.id === io.itemId);
                        const user = mockUsers.find(u => u.id === p.ownerId);
                        allItemsOut.push({
                            ...io,
                            itemName: item ? item.name : 'Unknown',
                            sku: item ? item.sku : 'N/A',
                            projectName: p.name,
                            userName: user ? user.name : p.ownerId
                        });
                    });
                });

                tabContent.innerHTML = allItemsOut.length === 0 ? '<p class="text-muted">No items currently signed out.</p>' :
                    `<ul class="stock-list">${allItemsOut.map(io => {
                        const isOverdue = new Date(io.dueDate) < new Date();
                        return `
                        <li class="stock-item">
                            <div>
                                <strong style="display:block">${io.itemName} (x${io.quantity})</strong>
                                <small class="text-muted block">SKU: ${io.sku}</small>
                                <span class="text-muted block text-sm">${io.userName} — ${io.projectName === 'Personal Use' ? '<span class="text-accent">Personal</span>' : io.projectName}</span>
                            </div>
                            <span class="${isOverdue ? 'text-danger' : 'text-warning'} font-bold text-sm" style="white-space:nowrap">
                                ${isOverdue ? 'Overdue!' : 'Due: ' + new Date(io.dueDate).toLocaleDateString()}
                            </span>
                        </li>`;
                    }).join('')}</ul>`;
            } else if (tab === 'projectsummary') {
                const visibleProjects = projects.filter(p => canCurrentUserViewProject(p));
                const summaryRows = visibleProjects
                    .map(p => {
                        const outQty = p.itemsOut.reduce((acc, io) => acc + io.quantity, 0);
                        const dueQty = p.itemsOut.reduce((acc, io) => acc + ((io.dueDate && new Date(io.dueDate) <= now) ? io.quantity : 0), 0);
                        return {
                            id: p.id,
                            name: p.name,
                            owner: getProjectOwnerLabel(p),
                            outQty,
                            dueQty
                        };
                    })
                    .filter(row => row.outQty > 0)
                    .sort((a, b) => b.outQty - a.outQty);

                tabContent.innerHTML = summaryRows.length === 0
                    ? '<p class="text-muted">No projects currently have items signed out.</p>'
                    : `<ul class="stock-list">${summaryRows.map(row => `
                        <li class="stock-item dashboard-project-summary" style="gap:0.75rem;align-items:flex-start;">
                            <div>
                                <strong>${row.name}</strong>
                                <small class="text-muted block">Owner: ${row.owner}</small>
                                <small class="text-muted block">Out: ${row.outQty} · Due now: ${row.dueQty}</small>
                            </div>
                            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;">
                                <button class="btn btn-secondary text-sm dashboard-project-open-btn" data-project-id="${row.id}" style="padding:0.25rem 0.5rem;font-size:0.75rem;">
                                    <i class="ph ph-folder-open"></i> Open
                                </button>
                                <button class="btn btn-primary text-sm dashboard-project-items-btn" data-project-id="${row.id}" style="padding:0.25rem 0.5rem;font-size:0.75rem;">
                                    <i class="ph ph-list"></i> Items
                                </button>
                            </div>
                        </li>
                    `).join('')}</ul>`;

                wireDashboardProjectSummaryActions(tabContent);
            }
        }

        // Render default tab
        renderAdminTab('lowstock');

        // Wire tab buttons
        document.querySelectorAll('.widget-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.widget-tab').forEach(t => {
                    t.classList.remove('active');
                    t.style.borderBottomColor = 'transparent';
                    t.style.color = 'var(--text-secondary)';
                });
                tab.classList.add('active');
                tab.style.borderBottomColor = 'var(--accent-primary)';
                tab.style.color = 'var(--text-primary)';
                renderAdminTab(tab.getAttribute('data-tab'));
            });
        });

        // Set initial active tab styling
        const firstTab = document.querySelector('.widget-tab.active');
        if (firstTab) {
            firstTab.style.borderBottomColor = 'var(--accent-primary)';
            firstTab.style.color = 'var(--text-primary)';
        }
    }
}

/* =======================================
   INVENTORY LOGIC
   ======================================= */
function determineStatus(stock, threshold, itemType = 'item') {
    // Consumables don't show stock status
    if (itemType === 'consumable') return 'N/A';
    // Items show out of stock or low stock
    if (stock <= 0) return 'Out of Stock';
    if (stock <= threshold) return 'Low Stock';
    return 'In Stock';
}

function renderInventory(filterStr = 'All') {
    const tbody = document.getElementById('inventory-table-body');

    inventoryCategoryFilter = filterStr;
    inventorySearchTerm = String(document.getElementById('inventory-search')?.value || '').trim().toLowerCase();

    let filtered = currentUser.role === 'student'
        ? inventoryItems.filter(item => canUserSeeItem(currentUser, item))
        : inventoryItems;

    if (filterStr !== 'All') {
        filtered = inventoryItems.filter(i => i.category === filterStr);
        if (currentUser.role === 'student') {
            filtered = filtered.filter(item => canUserSeeItem(currentUser, item));
        }
    }

    if (inventorySearchTerm) {
        filtered = filtered.filter(item => {
            const haystack = [
                item.name,
                item.id,
                item.sku,
                item.category,
                item.location,
                item.storageLocation,
                item.bin,
                item.description,
                item.notes
            ].map(value => String(value || '').toLowerCase()).join(' ');

            return haystack.includes(inventorySearchTerm);
        });
    }

    tbody.innerHTML = filtered.map(item => {
        const currentStatus = determineStatus(item.stock, item.threshold, item.item_type);
        const statusClass = currentStatus === 'In Stock' ? 'status-instock' : (currentStatus === 'Low Stock' || currentStatus === 'Out of Stock') ? 'status-lowstock' : 'status-na';
        const canSignOut = currentUser.perms?.canSignOut !== false;

        const tagsHtml = (item.visibilityTags || []).map(tag =>
            `<span class="visibility-tag">${tag}</span>`
        ).join('');

        return `
            <tr>
                <td><input type="checkbox" class="item-select-cb" data-id="${item.id}"></td>
                <td>
                    <div class="font-bold">${item.name}${renderMissingMetadataIcon(item)}</div>
                    ${item.sku ? `<small class="text-xs text-muted">SKU: ${item.sku}</small>` : ''}
                    ${tagsHtml ? `<div class="visibility-tags-row">${tagsHtml}</div>` : ''}
                </td>
                <td>${item.category}</td>
                <td class="text-muted font-mono" style="font-size:0.8rem">${item.sku}</td>
                <td>${item.stock}</td>
                <td><span class="status-badge ${statusClass}">${currentStatus}</span></td>
                <td>
                    <div class="flex" style="gap:0.65rem;flex-wrap:wrap;">
                        ${currentUser.role !== 'student' ? `
                            <button class="btn btn-secondary btn-sm edit-item-btn" data-id="${item.id}" title="Edit Item">
                                <i class="ph ph-pencil-simple"></i>
                            </button>` : ''}
                        <button class="btn btn-secondary btn-sm add-basket-btn" data-id="${item.id}" title="Add to Basket" 
                            style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2)">
                            <i class="ph ph-shopping-cart-simple"></i>
                        </button>
                        <button class="btn btn-primary btn-sm signout-btn" data-id="${item.id}" title="Sign out to Project">
                            <i class="ph ph-export"></i> Sign Out
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Select all items checkbox
    document.getElementById('select-all-items')?.addEventListener('change', (e) => {
        document.querySelectorAll('.item-select-cb').forEach(cb => { cb.checked = e.target.checked; });
    });

    // Select all users checkbox
    document.getElementById('select-all-users')?.addEventListener('change', (e) => {
        document.querySelectorAll('.user-select-cb').forEach(cb => { cb.checked = e.target.checked; });
    });

    // Attach listeners for actions
    // Attach basket listeners
    document.querySelectorAll('.add-basket-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            addToBasket(id);
        });
    });

    document.querySelectorAll('.signout-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openSignOutModal(id);
        });
    });

    // Attach edit item listeners
    document.querySelectorAll('.edit-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openEditItemModal(id);
        });
    });

    // Attach return item listeners (students)
    document.querySelectorAll('.return-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const itemId = e.currentTarget.getAttribute('data-id');
            const item = inventoryItems.find(i => i.id === itemId);
            if (!item) return;

            if (confirm(`Return ${item.name} to inventory?`)) {
                // Find the project and remove the item
                const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
                myProjects.forEach(p => {
                    const outIdx = p.itemsOut.findIndex(io => io.itemId === itemId);
                    if (outIdx > -1) {
                        item.stock += p.itemsOut[outIdx].quantity;
                        p.itemsOut.splice(outIdx, 1);
                    }
                });

                showToast(`${item.name} returned to inventory.`, 'success');
                addLog(currentUser.id, 'Return Item', `Returned ${item.name} to inventory`);
                renderInventory(filterStr);
            }
        });
    });
}

const filterBtns = document.querySelectorAll('.filter-btn');
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderInventory(btn.textContent.trim());
    });
});

document.getElementById('inventory-search')?.addEventListener('input', () => {
    renderInventory(inventoryCategoryFilter);
});

document.getElementById('request-item-btn')?.addEventListener('click', () => {
    openOrderRequestModal({
        initialName: document.getElementById('inventory-search')?.value || ''
    });
});

/* =======================================
   PROJECTS & SIGNOUT LOGIC
   ======================================= */
function canCurrentUserReturnProjectItem(project) {
    if (!currentUser) return false;
    if (currentUser.role !== 'student') return true;
    return project.ownerId === currentUser.id || project.collaborators.includes(currentUser.id);
}

function canCurrentUserViewProject(project) {
    if (!currentUser || !project) return false;
    if (currentUser.role !== 'student') return true;
    return project.ownerId === currentUser.id || project.collaborators.includes(currentUser.id);
}

function canCurrentUserManageProject(project) {
    if (!currentUser || !project) return false;
    if (currentUser.role !== 'student') return true;
    return project.ownerId === currentUser.id;
}

function getProjectStudentCandidates() {
    return mockUsers.filter(u => u.role === 'student');
}

function buildProjectCollaboratorOptions({ selectedOwnerId = '', selectedCollaborators = [] } = {}) {
    const selectedSet = new Set(selectedCollaborators || []);
    return getProjectStudentCandidates()
        .filter(student => student.id !== selectedOwnerId)
        .map(student => `
            <div style="margin-bottom:0.5rem">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                    <input type="checkbox" value="${student.id}" class="proj-student-checkbox" ${selectedSet.has(student.id) ? 'checked' : ''}>
                    ${student.name} (${student.id})
                </label>
            </div>
        `)
        .join('');
}

function getProjectOwnerLabel(project) {
    const owner = mockUsers.find(u => u.id === project.ownerId);
    return owner ? `${owner.name} (${owner.id})` : project.ownerId;
}

async function syncProjectCollaboratorsInSupabase(projectId, nextCollaborators, prevCollaborators) {
    const prev = new Set(prevCollaborators || []);
    const next = new Set(nextCollaborators || []);

    for (const userId of prev) {
        if (!next.has(userId)) {
            const removed = await removeProjectCollaboratorFromSupabase(projectId, userId);
            if (!removed) return false;
        }
    }

    for (const userId of next) {
        if (!prev.has(userId)) {
            const added = await addProjectCollaboratorToSupabase(projectId, userId);
            if (!added) return false;
        }
    }

    return true;
}

async function openProjectsPageAndFocusProject(projectId) {
    const projectsNavBtn = document.querySelector('.nav-btn[data-target="projects"]');
    navBtns.forEach(b => b.classList.remove('active'));
    projectsNavBtn?.classList.add('active');

    await switchPage('projects', 'Projects');

    requestAnimationFrame(() => {
        const card = document.querySelector(`.project-card[data-project-id="${projectId}"]`);
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('active-highlight');
        setTimeout(() => card.classList.remove('active-highlight'), 1800);
    });
}

function openProjectItemsModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project || !canCurrentUserViewProject(project)) {
        showToast('You do not have access to that project.', 'error');
        return;
    }

    const itemsHtml = project.itemsOut.length === 0
        ? '<p class="text-muted">No items are currently signed out for this project.</p>'
        : project.itemsOut.map(io => {
            const item = inventoryItems.find(i => i.id === io.itemId);
            const assignedUserId = io.assignedToUserId || project.ownerId;
            const assignedUser = mockUsers.find(u => u.id === assignedUserId);
            const due = io.dueDate ? new Date(io.dueDate) : null;
            const isDueNow = due ? due <= new Date() : false;
            return `
                <li class="stock-item dashboard-project-summary" style="border-left-width:3px;">
                    <div>
                        <strong>${item ? item.name : io.itemId} (x${io.quantity})</strong>
                        <small class="text-muted block">Assigned: ${assignedUser ? assignedUser.name : assignedUserId}</small>
                        <small class="text-muted block">SKU: ${item ? item.sku : 'N/A'}</small>
                    </div>
                    <span class="${isDueNow ? 'text-danger' : 'text-warning'} font-bold text-sm">
                        ${due ? (isDueNow ? 'Due now' : `Due: ${due.toLocaleDateString()}`) : 'No due date'}
                    </span>
                </li>
            `;
        }).join('');

    const html = `
        <div class="modal-header">
            <h3>Project Items: ${project.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
            <p class="text-muted mb-4">Owner: ${getProjectOwnerLabel(project)}</p>
            <ul class="stock-list">${itemsHtml}</ul>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" id="open-project-tab-btn" data-project-id="${project.id}">
                <i class="ph ph-folder-open"></i> Open In Projects
            </button>
        </div>
    `;

    openModal(html);
    document.getElementById('open-project-tab-btn')?.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-project-id');
        closeModal();
        await openProjectsPageAndFocusProject(id);
    });
}

function wireDashboardProjectSummaryActions(scope = document) {
    scope.querySelectorAll('.dashboard-project-open-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-project-id');
            await openProjectsPageAndFocusProject(id);
        });
    });

    scope.querySelectorAll('.dashboard-project-items-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-project-id');
            openProjectItemsModal(id);
        });
    });
}

function findSignoutIndex(project, signoutId) {
    return project.itemsOut.findIndex(io => (io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`) === signoutId);
}

async function returnProjectItem(projectId, signoutId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const ioIndex = findSignoutIndex(project, signoutId);
    if (ioIndex < 0) return;

    const io = project.itemsOut[ioIndex];
    const item = inventoryItems.find(i => i.id === io.itemId);
    const assignedToUserId = io.assignedToUserId || project.ownerId;
    const assignedToUser = mockUsers.find(u => u.id === assignedToUserId);

    if (currentUser.role === 'student' && currentUser.id !== assignedToUserId) {
        const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
        const confirmOnBehalf = confirm(`This item is assigned to ${assignedName}. Sign it back in on their behalf?`);
        if (!confirmOnBehalf) return;
    }

    if (currentUser?.role === 'student') {
        const unlocked = await requestDoorUnlockAndLogAccess({
            actionType: 'sign-in',
            item,
            quantity: io.quantity,
            projectName: project.name
        });

        if (!unlocked) {
            showToast('Door unlock denied. Return canceled.', 'error');
            return;
        }
    }

    if (item) {
        const nextStock = item.stock + io.quantity;
        const stockUpdated = await updateItemInSupabase(item.id, { stock: nextStock });
        if (!stockUpdated) {
            showToast('Failed to update item stock in Supabase.', 'error');
            return;
        }
    }

    if (io.id) {
        const returned = await returnItemToSupabase(io.id);
        if (!returned) {
            showToast('Failed to return item in Supabase.', 'error');
            return;
        }
    }

    await Promise.all([
        refreshProjectsFromSupabase(),
        refreshInventoryFromSupabase()
    ]);

    if (currentUser.id !== assignedToUserId) {
        const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
        addLog(currentUser.id, 'Return On Behalf', `Returned ${io.quantity}x ${item ? item.name : io.itemId} for ${assignedName} in ${project.name}`);
        showToast(`Returned on behalf of ${assignedName}.`, 'warning');
    } else {
        addLog(currentUser.id, 'Return Item', `Returned ${io.quantity}x ${item ? item.name : io.itemId} in ${project.name}`);
        showToast('Item signed back in.', 'success');
    }

    renderProjects();
    renderInventory();
    loadDashboard();
}

function renderProjects() {
    const container = document.getElementById('projects-container');

    // Filter projects based on role
    // Students see only projects they own or collaborate on (active or past)
    // Teachers/Devs see ALL projects (past and active)
    let visibleProjects = projects;
    if (currentUser.role === 'student') {
        visibleProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
    }

    if (visibleProjects.length === 0) {
        container.innerHTML = '<p class="text-muted col-span-full">No projects found.</p>';
        return;
    }

    container.innerHTML = visibleProjects.map(proj => {
        const owner = mockUsers.find(u => u.id === proj.ownerId);
        const outCount = proj.itemsOut.reduce((acc, curr) => acc + curr.quantity, 0);
        const canManage = canCurrentUserManageProject(proj);

        // List items out
        const itemsOutHtml = proj.itemsOut.length > 0 ? `
            <div class="mt-4 pt-4" style="border-top: 1px solid var(--glass-border)">
                <div class="text-xs uppercase tracking-wider text-muted mb-2">Signed-out Items</div>
                <div style="display:flex; flex-direction:column; gap:0.5rem">
                    ${proj.itemsOut.map(io => {
            const item = inventoryItems.find(i => i.id === io.itemId);
            const assignedUserId = io.assignedToUserId || proj.ownerId;
            const assignedUser = mockUsers.find(u => u.id === assignedUserId);
            const signoutId = io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`;
            return `
                            <div class="flex justify-between items-center text-sm" style="gap:0.75rem;">
                                <div>
                                    <span>${io.quantity}x <strong>${item ? item.name : 'Unknown'}</strong></span>
                                    <div class="text-xs text-muted">Assigned: ${assignedUser ? assignedUser.name : assignedUserId}</div>
                                </div>
                                <div style="display:flex;align-items:center;gap:0.5rem;">
                                    <span class="text-muted font-mono" style="font-size:0.75rem">${item ? item.sku : 'N/A'}</span>
                                    ${canCurrentUserReturnProjectItem(proj) ? `<button class="btn btn-secondary text-sm return-project-item-btn" data-project-id="${proj.id}" data-signout-id="${signoutId}" style="padding:0.2rem 0.5rem;font-size:0.75rem;"><i class="ph ph-arrow-counter-clockwise"></i> Sign In</button>` : ''}
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        ` : '';

        return `
            <div class="project-card glass-panel flex-col" data-project-id="${proj.id}">
                <div class="project-header">
                    <div>
                        <h4>${proj.name}</h4>
                    </div>
                    <span class="status-badge status-instock">${proj.status}</span>
                </div>
                <p class="text-muted text-sm mb-2">Owner: ${owner ? owner.name : 'Unknown'}</p>
                <p class="project-desc mb-4">${proj.description}</p>
                <div class="project-footer"><strong>${outCount}</strong> items signed out</div>
                ${itemsOutHtml}
                <div class="project-meta">
                    <span class="text-muted text-sm">${proj.itemsOut.length > 0 ? 'Use Sign In to return tools.' : 'No items currently signed out.'}</span>
                    ${canManage ? `<button class="btn btn-secondary text-sm edit-proj-btn" data-id="${proj.id}">
                        <i class="ph ph-pencil-simple"></i> Edit
                    </button>` : ''}
                    <button class="btn btn-secondary text-sm view-proj-btn" data-id="${proj.id}">Details</button>
                </div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.edit-proj-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openEditProjectModal(id);
        });
    });

    document.querySelectorAll('.view-proj-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openProjectItemsModal(id);
        });
    });

    document.querySelectorAll('.return-project-item-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const projectId = e.currentTarget.getAttribute('data-project-id');
            const signoutId = e.currentTarget.getAttribute('data-signout-id');
            await returnProjectItem(projectId, signoutId);
        });
    });
}

function openSignOutModal(itemId) {
    if (currentUser.role === 'student' && !currentUser.perms?.canSignOut) {
        showToast('You do not have permission to sign out items.', 'error');
        return;
    }

    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    if (currentUser.role === 'student' && !canUserSeeItem(currentUser, item)) {
        showToast('Your class level cannot access this item.', 'error');
        return;
    }

    if (item.stock <= 0) {
        showToast('Item out of stock!', 'error');
        return;
    }

    // Only show active projects where current user is owner or collaborator
    const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));

    const personalOption = `<option value="personal">Personal (Individual)</option>`;
    const projectsOptions = personalOption + myProjects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

    const html = `
        <div class="modal-header">
            <h3>Sign Out Item</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">You are signing out: <strong>${item.name}</strong></p>
            <div class="glass-panel" style="padding:0.85rem;margin-bottom:0.9rem;border-radius:var(--radius-sm)">
                <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
                    <div>
                        <div class="font-bold">${item.name}</div>
                        <small class="text-muted">SKU: ${item.sku || 'N/A'} | Category: ${item.category || 'N/A'}</small>
                    </div>
                    <span class="badge" style="background:rgba(245,158,11,0.2);color:var(--warning)">In Stock: ${item.stock}</span>
                </div>
                <div style="margin-top:0.45rem">
                    <small><strong>Location:</strong> ${formatItemExtraInfo(item).location}</small><br>
                    <small><strong>Description:</strong> ${formatItemExtraInfo(item).description}</small>
                </div>
                <div style="margin-top:0.45rem">
                    <small><strong>Due Date (preview):</strong> ${new Date(calculateDueDate(new Date(), currentUser)).toLocaleString()}</small>
                </div>
            </div>
            <div class="form-group">
                <label>Select Project</label>
                <select id="so-project" class="form-control">
                    ${projectsOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Quantity (Max: ${item.stock})</label>
                <input type="number" id="so-qty" class="form-control" min="1" max="${item.stock}" value="1">
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-signout">Confirm Sign Out</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-signout').addEventListener('click', async () => {
        const projId = document.getElementById('so-project').value;
        const qty = parseInt(document.getElementById('so-qty').value);

        if (qty > 0 && qty <= item.stock) {
            let project;
            if (projId === 'personal') {
                project = getOrCreatePersonalProject(currentUser.id);
            } else {
                project = projects.find(p => p.id === projId);
            }

            if (!project) {
                showToast('Unable to resolve target project.', 'error');
                return;
            }

            if (project.id.startsWith('PERS-')) {
                const ensured = await ensureProjectExistsInSupabase(project);
                if (!ensured) {
                    showToast('Failed to create personal project in Supabase.', 'error');
                    return;
                }
            }

            if (currentUser?.role === 'student') {
                const unlocked = await requestDoorUnlockAndLogAccess({
                    actionType: 'sign-out',
                    item,
                    quantity: qty,
                    projectName: project?.name || 'Personal'
                });

                if (!unlocked) {
                    showToast('Door unlock denied. Sign-out canceled.', 'error');
                    return;
                }
            }

            // Update stock
            item.stock -= qty;
            await updateItemInSupabase(item.id, { stock: item.stock }).catch(err => {
                console.error('Failed to update item stock in Supabase:', err);
            });

            // Update Project
            // Ensure project is set (already selected above)

            const signoutData = {
                id: generateId('OUT'),
                itemId: item.id,
                quantity: qty,
                signoutDate: new Date().toISOString(),
                dueDate: calculateDueDate(new Date(), currentUser),
                assignedToUserId: project.ownerId,
                signedOutByUserId: currentUser.id
            };
            project.itemsOut.push(signoutData);

            await addProjectItemOutToSupabase({
                projectId: project.id,
                itemId: item.id,
                quantity: qty,
                signoutDate: signoutData.signoutDate,
                dueDate: signoutData.dueDate
            }).catch(err => {
                console.error('Failed to save signout in Supabase:', err);
            });

            _trackItemSignout(item, qty);
            // Log activity
            addLog(currentUser.id, 'Sign Out', `Signed out ${qty}x ${item.name} (SKU: ${item.sku}) for Project: ${project.name === 'Personal Use' ? 'Personal' : project.name}`);

            showToast(`Successfully signed out ${qty} items!`, 'success');
            closeModal();

            // Refresh current views
            renderInventory();
        } else {
            showToast('Invalid quantity!', 'error');
        }
    });
}

/* =======================================
   CLASSES LOGIC
   ======================================= */
if (!Array.isArray(studentClasses)) {
    studentClasses = [];
}

function renderClasses() {
    const container = document.getElementById('classes-container');
    if (currentUser.role === 'student') return;

    const createClassBtn = document.getElementById('create-class-btn');
    if (createClassBtn) {
        if (currentUser && ['teacher', 'developer'].includes(currentUser.role)) {
            createClassBtn.classList.remove('hidden');
        } else {
            createClassBtn.classList.add('hidden');
        }
    }

    if (!studentClasses.length) {
        container.innerHTML = '<p class="text-muted col-span-full">No classes created yet.</p>';
        return;
    }

    container.innerHTML = studentClasses.map(cls => {
        const studentCount = cls.students.length;
        const visibleItemCount = getVisibleItemCountForClass(cls);
        const classDuePolicy = normalizeDuePolicy(cls.duePolicy);
        const teacher = mockUsers.find(u => u.id === cls.teacherId);
        const allowedTags = cls.allowedVisibilityTags || [];
        const tagsDisplay = allowedTags.length > 0
            ? allowedTags.map(t => `<span class="visibility-tag">${t}</span>`).join('')
            : '<span class="text-muted text-sm">None (all untagged items visible)</span>';

        return `
            <div class="project-card glass-panel" style="position:relative">
                <div style="position:absolute; top:1rem; right:1rem; display:flex; gap:0.5rem;">
                    <button class="icon-btn text-accent edit-class-btn" data-id="${cls.id}" title="Edit Class"><i class="ph ph-pencil-simple"></i></button>
                    <button class="icon-btn text-danger delete-class-btn" data-id="${cls.id}" title="Delete Class"><i class="ph ph-trash"></i></button>
                </div>
                <div class="project-header">
                    <h3 style="color: var(--accent-secondary)">${cls.name}</h3>
                </div>
                <div class="text-sm mt-4"><strong>${studentCount}</strong> Students Enrolled</div>
                <div class="text-sm"><strong>Visible Items:</strong> ${visibleItemCount}</div>
                <div class="text-sm"><strong>Default Due Minutes:</strong> ${classDuePolicy.defaultSignoutMinutes}</div>
                <div class="text-sm" style="margin-top:0.4rem"><strong>Allowed Visibility Tags:</strong><br><div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.3rem">${tagsDisplay}</div></div>
                <div class="project-meta text-sm">
                    <span class="text-muted">Teacher: ${teacher ? teacher.name : 'Unknown'}</span>
                </div>
                <div class="text-sm text-muted" style="margin-top:0.5rem">
                    ${cls.students.map(sId => {
            const s = mockUsers.find(u => u.id === sId);
            return s ? s.name : sId;
        }).join(', ') || 'No students'}
                </div>
            </div>
        `;
    }).join('');

    // Edit class handler
    document.querySelectorAll('.edit-class-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openEditClassModal(id);
        });
    });

    document.querySelectorAll('.delete-class-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const cls = studentClasses.find(c => c.id === id);
            if (confirm(`Are you sure you want to delete ${cls.name}? This cannot be undone.`)) {
                const deleted = await deleteStudentClassInSupabase(id);
                if (!deleted) {
                    showToast('Failed to delete class from Supabase.', 'error');
                    return;
                }
                studentClasses = studentClasses.filter(c => c.id !== id);
                showToast(`Class ${cls.name} deleted.`, 'success');
                addLog(currentUser.id, 'Delete Class', `Deleted student class: ${cls.name}`);
                renderClasses();
            }
        });
    });
}

function bindCheckboxListControls({
    searchInputId,
    listContainerId,
    checkboxClass,
    selectAllBtnId,
    clearBtnId
}) {
    const searchInput = document.getElementById(searchInputId);
    const listContainer = document.getElementById(listContainerId);
    const selectAllBtn = document.getElementById(selectAllBtnId);
    const clearBtn = document.getElementById(clearBtnId);

    if (!listContainer) return;

    const applyFilter = () => {
        const query = (searchInput?.value || '').trim().toLowerCase();
        listContainer.querySelectorAll('.class-list-option').forEach(option => {
            const label = option.getAttribute('data-label') || '';
            option.style.display = !query || label.includes(query) ? '' : 'none';
        });
    };

    searchInput?.addEventListener('input', applyFilter);

    selectAllBtn?.addEventListener('click', () => {
        listContainer.querySelectorAll(`.${checkboxClass}`).forEach(cb => {
            const option = cb.closest('.class-list-option');
            if (!option || option.style.display !== 'none') cb.checked = true;
        });
    });

    clearBtn?.addEventListener('click', () => {
        listContainer.querySelectorAll(`.${checkboxClass}`).forEach(cb => {
            const option = cb.closest('.class-list-option');
            if (!option || option.style.display !== 'none') cb.checked = false;
        });
    });
}

function openEditClassModal(classId) {
    const cls = studentClasses.find(c => c.id === classId);
    if (!cls) return;

    const availableStudents = mockUsers.filter(u => u.role === 'student');
    const studentOptions = availableStudents.map(s =>
        `<div class="class-list-option" data-label="${`${s.name} ${s.id}`.toLowerCase()}" style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${s.id}" class="edit-class-student-checkbox" ${cls.students.includes(s.id) ? 'checked' : ''}>
                ${s.name} (${s.id})
            </label>
        </div>`
    ).join('');

    const classDuePolicy = normalizeDuePolicy(cls.duePolicy);

    const allowedTagSet = new Set(cls.allowedVisibilityTags || []);
    const tagOptions = visibilityTags.map(tag =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem">
            <input type="checkbox" class="edit-class-tag-cb" value="${tag}" ${allowedTagSet.has(tag) ? 'checked' : ''}> ${tag}
        </label>`
    ).join('');

    const html = `
        <div class="modal-header">
            <h3>Edit Class: ${cls.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Class Name</label>
                <input type="text" id="edit-class-name" class="form-control" value="${cls.name}">
            </div>
            <div class="form-group">
                <label>Students</label>
                <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;">
                    <input type="text" id="edit-class-student-search" class="form-control" placeholder="Search students by name or ID" style="flex:1;min-width:220px;">
                    <button type="button" class="btn btn-secondary" id="edit-class-student-select-all">Select Visible</button>
                    <button type="button" class="btn btn-secondary" id="edit-class-student-clear">Clear Visible</button>
                </div>
                <div class="glass-panel" id="edit-class-student-list" style="padding:1rem; max-height:200px; overflow-y:auto">
                    ${studentOptions || '<p class="text-muted">No students available.</p>'}
                </div>
            </div>
            <div class="form-group">
                <label>Allowed Visibility Tags</label>
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Visibility is tag-based only. Students see items with ANY checked tag. Items with no tags are always visible.</small>
                <div class="glass-panel" style="padding:0.75rem">
                    ${tagOptions || '<p class="text-muted text-sm">No visibility tags defined.</p>'}
                </div>
            </div>
            <div class="form-group">
                <label>Time Zone</label>
                <select id="edit-class-timezone" class="form-control">
                    ${buildTimezoneOptionsHtml(classDuePolicy.timezone)}
                </select>
                <small class="text-muted">Used to determine which class period a sign-out falls in.</small>
            </div>
            <div class="form-group">
                <label>Default Return Window (minutes)</label>
                <input type="number" id="edit-class-default-due" class="form-control" min="1" value="${classDuePolicy.defaultSignoutMinutes}">
                <small class="text-muted">Used when a sign-out happens outside any class period — student gets this many minutes to return the item.</small>
            </div>
            <div class="form-group">
                <label>Minutes Per Class Period</label>
                <input type="number" id="edit-class-period-mins" class="form-control" min="1" value="${classDuePolicy.classPeriodMinutes}">
                <small class="text-muted">Used with class periods below — due time = return periods × this value.</small>
            </div>
            <div class="form-group">
                <label>Class Periods</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 110px 36px;gap:0.5rem;margin-bottom:0.25rem">
                    <span class="text-muted" style="font-size:0.8rem">Start</span>
                    <span class="text-muted" style="font-size:0.8rem">End</span>
                    <span class="text-muted" style="font-size:0.8rem">Return Periods</span>
                    <span></span>
                </div>
                <div id="edit-class-period-rows">${buildPeriodRowsHtml(classDuePolicy.periodRanges)}</div>
                <button type="button" id="edit-class-add-period-btn" class="btn btn-secondary" style="margin-top:0.5rem">
                    <i class="ph ph-plus"></i> Add Period
                </button>
                <small class="text-muted" style="display:block;margin-top:0.4rem">When a sign-out falls within a period window, the return deadline = return periods × minutes per class period.</small>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-class">Save Changes</button>
        </div>
    `;

    openModal(html);
    dynamicModal.classList.add('class-modal');

    bindCheckboxListControls({
        searchInputId: 'edit-class-student-search',
        listContainerId: 'edit-class-student-list',
        checkboxClass: 'edit-class-student-checkbox',
        selectAllBtnId: 'edit-class-student-select-all',
        clearBtnId: 'edit-class-student-clear'
    });

    attachPeriodRowHandlers('edit-class-period-rows', 'edit-class-add-period-btn');

    document.getElementById('confirm-edit-class').addEventListener('click', async () => {
        const name = document.getElementById('edit-class-name').value.trim();
        const checkedStudents = Array.from(document.querySelectorAll('.edit-class-student-checkbox:checked')).map(cb => cb.value);
        const checkedTags = Array.from(document.querySelectorAll('.edit-class-tag-cb:checked')).map(cb => cb.value);
        const defaultDueMinutes = Math.max(1, parseInt(document.getElementById('edit-class-default-due').value, 10) || 80);
        const classPeriodMinutes = Math.max(1, parseInt(document.getElementById('edit-class-period-mins').value, 10) || 50);
        const timezone = document.getElementById('edit-class-timezone').value;
        const parsedRanges = collectPeriodRowsFromModal('edit-class-period-rows');

        if (name) {
            cls.name = name;
            cls.students = checkedStudents;
            cls.visibleItemIds = [];
            cls.allowedVisibilityTags = checkedTags;
            cls.duePolicy = normalizeDuePolicy({
                defaultSignoutMinutes: defaultDueMinutes,
                classPeriodMinutes: classPeriodMinutes,
                timezone,
                periodRanges: parsedRanges
            });

            const saved = await saveStudentClassToSupabase(cls);
            if (!saved) {
                showToast('Failed to save class updates to Supabase.', 'error');
                return;
            }

            showToast(`Class ${name} updated.`, 'success');
            addLog(currentUser.id, 'Edit Class', `Updated class ${name} with ${checkedStudents.length} students.`);
            closeModal();
            if (document.getElementById('page-classes').classList.contains('active')) {
                renderClasses();
            }
        }
    });
}

document.getElementById('create-class-btn')?.addEventListener('click', () => {
    if (!currentUser || !['teacher', 'developer'].includes(currentUser.role)) {
        showToast('Only teachers and developers can create classes.', 'error');
        return;
    }

    // Only show students
    const availableStudents = mockUsers.filter(u => u.role === 'student');
    const studentOptions = availableStudents.map(s =>
        `<div class="class-list-option" data-label="${`${s.name} ${s.id}`.toLowerCase()}" style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${s.id}" class="student-checkbox">
                ${s.name} (${s.id})
            </label>
        </div>`
    ).join('');

    const newClassTagOptions = visibilityTags.map(tag =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem">
            <input type="checkbox" class="add-class-tag-cb" value="${tag}"> ${tag}
        </label>`
    ).join('');

    const defaultRangesHtml = buildPeriodRowsHtml(defaultDuePolicy.periodRanges);

    const html = `
        <div class="modal-header">
            <h3>Create New Class</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Class Name</label>
                <input type="text" id="add-class-name" class="form-control" placeholder="e.g. Adv. Electronics">
            </div>
            <div class="form-group">
                <label>Select Students</label>
                <div style="display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;">
                    <input type="text" id="add-class-student-search" class="form-control" placeholder="Search students by name or ID" style="flex:1;min-width:220px;">
                    <button type="button" class="btn btn-secondary" id="add-class-student-select-all">Select Visible</button>
                    <button type="button" class="btn btn-secondary" id="add-class-student-clear">Clear Visible</button>
                </div>
                <div class="glass-panel" id="add-class-student-list" style="padding:1rem; max-height:200px; overflow-y:auto">
                    ${studentOptions}
                </div>
            </div>
            <div class="form-group">
                <label>Allowed Visibility Tags</label>
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Visibility is tag-based only. Students see items with ANY checked tag. Items with no tags are always visible.</small>
                <div class="glass-panel" style="padding:0.75rem">
                    ${newClassTagOptions || '<p class="text-muted text-sm">No visibility tags defined.</p>'}
                </div>
            </div>
            <div class="form-group">
                <label>Time Zone</label>
                <select id="add-class-timezone" class="form-control">
                    ${buildTimezoneOptionsHtml(defaultDuePolicy.timezone)}
                </select>
                <small class="text-muted">Used to determine which class period a sign-out falls in.</small>
            </div>
            <div class="form-group">
                <label>Default Return Window (minutes)</label>
                <input type="number" id="add-class-default-due" class="form-control" min="1" value="${defaultDuePolicy.defaultSignoutMinutes}">
                <small class="text-muted">Used when a sign-out happens outside any class period — student gets this many minutes to return the item.</small>
            </div>
            <div class="form-group">
                <label>Minutes Per Class Period</label>
                <input type="number" id="add-class-period-mins" class="form-control" min="1" value="${defaultDuePolicy.classPeriodMinutes}">
                <small class="text-muted">Used with class periods below — due time = return periods × this value.</small>
            </div>
            <div class="form-group">
                <label>Class Periods</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 110px 36px;gap:0.5rem;margin-bottom:0.25rem">
                    <span class="text-muted" style="font-size:0.8rem">Start</span>
                    <span class="text-muted" style="font-size:0.8rem">End</span>
                    <span class="text-muted" style="font-size:0.8rem">Return Periods</span>
                    <span></span>
                </div>
                <div id="add-class-period-rows">${defaultRangesHtml}</div>
                <button type="button" id="add-class-add-period-btn" class="btn btn-secondary" style="margin-top:0.5rem">
                    <i class="ph ph-plus"></i> Add Period
                </button>
                <small class="text-muted" style="display:block;margin-top:0.4rem">When a sign-out falls within a period window, the return deadline = return periods × minutes per class period.</small>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-class">Create Class</button>
        </div>
    `;

    openModal(html);
    dynamicModal.classList.add('class-modal');

    bindCheckboxListControls({
        searchInputId: 'add-class-student-search',
        listContainerId: 'add-class-student-list',
        checkboxClass: 'student-checkbox',
        selectAllBtnId: 'add-class-student-select-all',
        clearBtnId: 'add-class-student-clear'
    });

    attachPeriodRowHandlers('add-class-period-rows', 'add-class-add-period-btn');

    document.getElementById('confirm-add-class').addEventListener('click', async (e) => {
        const submitBtn = e.currentTarget;
        withButtonPending(submitBtn, 'Creating...', async () => {
            const name = document.getElementById('add-class-name').value.trim();
            const checkedStudents = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
            const checkedTags = Array.from(document.querySelectorAll('.add-class-tag-cb:checked')).map(cb => cb.value);
            const defaultDueMinutes = Math.max(1, parseInt(document.getElementById('add-class-default-due').value, 10) || 80);
            const classPeriodMinutes = Math.max(1, parseInt(document.getElementById('add-class-period-mins').value, 10) || 50);
            const timezone = document.getElementById('add-class-timezone').value;
            const parsedRanges = collectPeriodRowsFromModal('add-class-period-rows');

            if (name) {
                const newClass = {
                    id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : generateId('CLS'),
                    name: name,
                    teacherId: currentUser.id,
                    students: checkedStudents,
                    visibleItemIds: [],
                    allowedVisibilityTags: checkedTags,
                    duePolicy: normalizeDuePolicy({
                        defaultSignoutMinutes: defaultDueMinutes,
                        classPeriodMinutes: classPeriodMinutes,
                        timezone,
                        periodRanges: parsedRanges
                    }),
                    defaultPermissions: { canCreateProjects: false, canJoinProjects: true, canSignOut: true }
                };

                const saved = await saveStudentClassToSupabase(newClass);
                if (!saved) {
                    showToast('Failed to create class in Supabase.', 'error');
                    return;
                }

                studentClasses.unshift(newClass);
                showToast(`Class ${name} created with ${checkedStudents.length} students.`, 'success');
                addLog(currentUser.id, 'Create Class', `Created class ${name} with ${checkedStudents.length} students.`);
                closeModal();
                if (document.getElementById('page-classes') && document.getElementById('page-classes').classList.contains('active')) {
                    renderClasses();
                }
            } else {
                showToast('Class name is required', 'error');
            }
        });
    });
});


/* =======================================
   LOGS LOGIC
   ======================================= */
function renderLogs() {
    const tbody = document.getElementById('logs-table-body');
    const actionFilter = document.getElementById('logs-action-filter');
    if (currentUser.role === 'student') return; // Double check protection

    if (actionFilter) {
        const previousValue = actionFilter.value || 'all';
        const actions = [...new Set(activityLogs.map(log => log.action).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));

        actionFilter.innerHTML =
            '<option value="all">View All Actions</option>' +
            actions.map(action => `<option value="${action}">${action}</option>`).join('');

        actionFilter.value = actions.includes(previousValue) || previousValue === 'all'
            ? previousValue
            : 'all';

        if (!actionFilter.dataset.bound) {
            actionFilter.addEventListener('change', () => renderLogs());
            actionFilter.dataset.bound = '1';
        }
    }

    const selectedAction = actionFilter?.value || 'all';
    const filteredLogs = selectedAction === 'all'
        ? activityLogs
        : activityLogs.filter(log => log.action === selectedAction);

    tbody.innerHTML = filteredLogs.map(log => {
        const idToMatch = log.userId || log.user_id;
        const trUser = mockUsers.find(u => u.id === idToMatch);
        return `
            <tr>
                <td class="text-muted"><small>${new Date(log.timestamp).toLocaleString()}</small></td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span style="font-size:1.2rem">${getRoleIcon(trUser?.role)}</span>
                        ${trUser?.name || idToMatch || 'Unknown User'}
                    </div>
                </td>
                <td><strong>${log.action}</strong></td>
                <td>${log.details}</td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="4" class="text-center text-muted">No log entries for this action.</td></tr>';
}


/* =======================================
   USERS LOGIC
   ======================================= */
function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    if (currentUser.role === 'student' || !tbody) return;

    tbody.innerHTML = mockUsers.map(user => {
        const suspensionBypassed = isSuspensionBypassedUser(user);
        const isSuspended = user.status === 'Suspended' && !suspensionBypassed;
        const canEdit = !(currentUser.role === 'teacher' && user.role === 'developer');

        return `
            <tr class="${isSuspended ? 'opacity-60' : ''}">
                <td>
                    <input type="checkbox" class="user-select-cb" data-id="${user.id}">
                </td>
                <td>
                    <div class="flex items-center gap-2">
                        <div class="avatar-sm" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:var(--glass-border);border-radius:50%;">${getRoleIcon(user.role)}</div>
                        <div>
                            <div class="font-bold">${user.name}</div>
                            <small class="text-muted">${user.id}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="flex flex-col items-start gap-1">
                        <span class="badge" style="color:${user.role === 'developer' ? '#8b5cf6' : user.role === 'teacher' ? '#f59e0b' : '#94a3b8'}">
                            ${user.role}
                        </span>
                        ${isSuspended ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: var(--danger); font-size: 0.7rem; border: 1px solid rgba(239,68,68,0.2)">SUSPENDED</span>` : ''}
                        ${suspensionBypassed ? `<span class="badge" style="background: rgba(16,185,129,0.18); color: var(--success); font-size: 0.7rem; border: 1px solid rgba(16,185,129,0.28)">ALWAYS ACTIVE</span>` : ''}
                    </div>
                </td>
                <td>
                    <span class="status-indicator ${user.status === 'Active' ? 'bg-success' : 'bg-danger'}"></span>
                    ${user.status}
                </td>
                <td>
                    <div class="flex gap-2 user-actions">
                        ${canEdit ? `<button class="btn btn-secondary btn-sm edit-user-btn" data-id="${user.id}" title="Edit User"><i class="ph ph-pencil"></i></button>` : `<i class="ph ph-lock text-muted" title="Developer locked"></i>`}
                        <button class="btn btn-secondary btn-sm suspend-user-btn" data-id="${user.id}" title="${isSuspended ? 'Reactivate' : 'Suspend'}" ${suspensionBypassed ? 'disabled' : ''}>
                            <i class="ph ${isSuspended ? 'ph-user-check' : 'ph-user-minus'}"></i>
                        </button>
                        <button class="btn btn-danger btn-sm delete-user-btn" data-id="${user.id}" title="Delete"><i class="ph ph-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    document.querySelectorAll('.suspend-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const user = mockUsers.find(u => u.id === id);
            if (!user) return;

            if (currentUser?.id === id) {
                showToast('You cannot suspend your own account.', 'error');
                return;
            }

            if (isSuspensionBypassedUser(user) || user.role === 'developer') {
                showToast('Developers cannot be suspended.', 'error');
                return;
            }

            const isSuspending = user.status !== 'Suspended';
            if (isSuspending) {
                if (!confirm(`Are you sure you want to suspend ${user.name}? This will block their login access.`)) return;
            } else {
                if (!confirm(`Are you sure you want to reactivate ${user.name}?`)) return;
            }

            const nextStatus = isSuspending ? 'Suspended' : 'Active';
            const updated = await updateUserInSupabase(id, { status: nextStatus });
            if (!updated) {
                showToast('Failed to update user status in Supabase.', 'error');
                return;
            }
            await refreshUsersFromSupabase();
            showToast(`${user.name} is now ${nextStatus}`, 'info');
            addLog(currentUser.id, isSuspending ? 'Suspend User' : 'Activate User', `${isSuspending ? 'Suspended' : 'Activated'} user ${user.name} (${user.id})`);
            renderUsers();
        });
    });

    document.querySelectorAll('.edit-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openUserModal(id);
        });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const user = mockUsers.find(u => u.id === id);
            if (!user) return;

            if (currentUser.role === 'teacher' && user.role === 'developer') {
                showToast('Teachers cannot delete developers.', 'error');
                return;
            }

            if (confirm(`CRITICAL: Are you sure you want to delete ${user.name}? This action is permanent.`)) {
                const deletingCurrentUser = currentUser?.id === id;
                const deleted = await deleteUserFromSupabase(id);
                if (!deleted) {
                    showToast('Failed to delete user from Supabase.', 'error');
                    return;
                }

                studentClasses.forEach(cls => {
                    cls.students = cls.students.filter(sId => sId !== id);
                    if (cls.teacherId === id) cls.teacherId = null;
                });

                await refreshUsersFromSupabase();
                showToast(`${user.name} deleted.`);
                addLog(currentUser.id, 'Delete User', `Deleted user account: ${user.name} (${user.id})`);

                if (deletingCurrentUser) {
                    returnToLoginView({ message: 'Your account was deleted. Session ended.' });
                    return;
                }

                renderUsers();
            }
        });
    });
}

// User Grid/List View Toggles
let currentUsersView = 'list';
document.getElementById('view-list-btn')?.addEventListener('click', () => {
    currentUsersView = 'list';
    document.getElementById('view-list-btn').classList.add('active-view');
    document.getElementById('view-grid-btn').classList.remove('active-view');
    const container = document.querySelector('#page-users .table-container');
    if (container) container.classList.remove('grid-view-active');
});

document.getElementById('view-grid-btn')?.addEventListener('click', () => {
    currentUsersView = 'grid';
    document.getElementById('view-grid-btn').classList.add('active-view');
    document.getElementById('view-list-btn').classList.remove('active-view');
    const container = document.querySelector('#page-users .table-container');
    if (container) container.classList.add('grid-view-active');
});

function openUserModal(editId = null) {
    const isEdit = !!editId;
    const userToEdit = isEdit ? mockUsers.find(u => u.id === editId) : null;
    const canEditBarcode = isEdit && (currentUser.role === 'teacher' || currentUser.role === 'developer');

    // Default student permissions
    const cProjects = isEdit ? (userToEdit.perms?.canCreateProjects ?? false) : false;
    const cJoin = isEdit ? (userToEdit.perms?.canJoinProjects ?? true) : true;
    const cSignOut = isEdit ? (userToEdit.perms?.canSignOut ?? false) : false;

    const html = `
        <div class="modal-header">
            <h3>${isEdit ? 'Edit User' : 'Add New User'}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>User ID / Barcode</label>
                <input type="text" id="user-id" class="form-control" placeholder="e.g. STU-999" ${(isEdit && !canEditBarcode) ? 'disabled' : ''} value="${isEdit ? userToEdit.id : ''}">
                ${isEdit
            ? canEditBarcode
                ? '<small class="text-muted">Teachers and developers can edit this barcode. Changes apply immediately.</small>'
                : '<small class="text-muted">Only teachers and developers can edit this barcode.</small>'
            : ''}
            </div>
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="user-name-input" class="form-control" placeholder="Jane Doe" value="${isEdit ? userToEdit.name : ''}">
            </div>
            <div class="form-group">
                <label>Role</label>
                <select id="user-role-input" class="form-control">
                    <option value="student" ${isEdit && userToEdit.role === 'student' ? 'selected' : ''}>Student</option>
                    <option value="teacher" ${isEdit && userToEdit.role === 'teacher' ? 'selected' : ''}>Teacher</option>
                    <option value="developer" ${isEdit && userToEdit.role === 'developer' ? 'selected' : ''}>Developer</option>
                </select>
            <div class="form-group" id="class-assign-container" style="display: ${(!isEdit || userToEdit.role === 'student') ? 'block' : 'none'};">
                <label>Assigned Class</label>
                <select id="user-class-assign" class="form-control">
                    <option value="">No Class / Other</option>
                    ${studentClasses.map(cls => `<option value="${cls.id}" ${isEdit && cls.students.includes(userToEdit.id) ? 'selected' : ''}>${cls.name}</option>`).join('')}
                </select>
            </div>
            <div id="perms-container" class="form-group" style="padding-top: 1rem; border-top: 1px solid var(--glass-border); display: ${(!isEdit || userToEdit.role === 'student') ? 'block' : 'none'};">
                <div class="flex justify-between items-center mb-2">
                    <label>Granular Permissions</label>
                    <small class="text-muted" id="perms-source-hint">Manual Overrides</small>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:1.5rem">
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer">
                        <input type="checkbox" id="perm-create-proj" ${cProjects ? 'checked' : ''}> Can Create Projects
                    </label>
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer">
                        <input type="checkbox" id="perm-join-proj" ${cJoin ? 'checked' : ''}> Can Join Projects
                    </label>
                    <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer">
                        <input type="checkbox" id="perm-signout" ${cSignOut ? 'checked' : ''}> Can Sign Out Items
                    </label>
                </div>
                </div>
            </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            ${(currentUser.role === 'teacher' && isEdit && userToEdit.role === 'developer') ?
            `<span class="text-danger text-sm" style="margin-right:1rem"><i class="ph ph-lock"></i> Developer role locked</span>` :
            `<button class="btn btn-primary" id="confirm-user-btn">${isEdit ? 'Save Changes' : 'Add User'}</button>`
        }
        </div>
    `;

    openModal(html);

    document.getElementById('user-role-input').addEventListener('change', (e) => {
        const permsContainer = document.getElementById('perms-container');
        const classContainer = document.getElementById('class-assign-container');
        if (e.target.value === 'student') {
            permsContainer.style.display = 'block';
            if (classContainer) classContainer.style.display = 'block';
        } else {
            permsContainer.style.display = 'none';
            if (classContainer) classContainer.style.display = 'none';
        }
    });

    // Auto-update permissions based on class selection
    document.getElementById('user-class-assign').addEventListener('change', (e) => {
        const classId = e.target.value;
        const targetClass = studentClasses.find(c => c.id === classId);
        if (targetClass && targetClass.defaultPermissions) {
            document.getElementById('perm-create-proj').checked = targetClass.defaultPermissions.canCreateProjects;
            document.getElementById('perm-join-proj').checked = targetClass.defaultPermissions.canJoinProjects;
            document.getElementById('perm-signout').checked = targetClass.defaultPermissions.canSignOut;
            document.getElementById('perms-source-hint').textContent = 'Default from ' + targetClass.name;
        } else {
            document.getElementById('perms-source-hint').textContent = 'Manual Overrides';
        }
    });

    document.getElementById('confirm-user-btn').addEventListener('click', async () => {
        const id = document.getElementById('user-id').value.trim().toUpperCase();
        const name = document.getElementById('user-name-input').value.trim();
        const role = document.getElementById('user-role-input').value;

        // Developer role restrictions
        if (role === 'developer' && currentUser.role === 'teacher') {
            showToast('Only developers can create other developers.', 'error');
            return;
        }

        if (role === 'developer' && currentUser.role !== 'developer') {
            showToast('Only developers can assign the developer role.', 'error');
            return;
        }

        // Prevent teachers from becoming developers
        if (!isEdit && role === 'developer' && currentUser.role === 'teacher') {
            showToast('Teachers cannot become developers.', 'error');
            return;
        }

        // Check if a developer already exists (only when creating new developer)
        if (!isEdit && role === 'developer') {
            const existingDev = mockUsers.find(u => u.role === 'developer');
            if (existingDev) {
                showToast('Only one developer can exist in the system.', 'error');
                return;
            }
        }

        // Prevent changing a teacher to developer
        if (isEdit && userToEdit.role !== 'developer' && role === 'developer' && currentUser.role === 'teacher') {
            showToast('Teachers cannot make others developers.', 'error');
            return;
        }

        const perms = role === 'student' ? {
            canCreateProjects: document.getElementById('perm-create-proj').checked,
            canJoinProjects: document.getElementById('perm-join-proj').checked,
            canSignOut: document.getElementById('perm-signout').checked
        } : {
            canCreateProjects: true,
            canJoinProjects: true,
            canSignOut: true
        };

        const assignedClassId = document.getElementById('user-class-assign').value;

        if (!id || !name) {
            showToast('ID and Name are required.', 'error');
            return;
        }

        if (isEdit) {
            const originalId = userToEdit.id;
            const barcodeChanged = id !== originalId;

            if (barcodeChanged) {
                if (!canEditBarcode) {
                    showToast('Only teachers and developers can edit user barcodes.', 'error');
                    return;
                }

                if (mockUsers.some(u => u.id === id)) {
                    showToast('A user with this barcode already exists.', 'error');
                    return;
                }

                const renamed = await renameUserBarcodeInSupabase(originalId, id);
                if (!renamed) {
                    showToast('Failed to update user barcode in Supabase.', 'error');
                    return;
                }

                // Keep in-memory references aligned until fresh data reloads.
                studentClasses.forEach(cls => {
                    cls.students = cls.students.map(studentId => studentId === originalId ? id : studentId);
                    if (cls.teacherId === originalId) cls.teacherId = id;
                });

                projects.forEach(project => {
                    if (project.ownerId === originalId) project.ownerId = id;
                    project.collaborators = (project.collaborators || []).map(collaboratorId => collaboratorId === originalId ? id : collaboratorId);
                });

                if (currentUser.id === originalId) currentUser.id = id;
                userToEdit.id = id;
            }

            userToEdit.name = name;
            userToEdit.role = role;
            userToEdit.perms = perms;

            // Update Class Alignment
            studentClasses.forEach(cls => {
                cls.students = cls.students.filter(sId => sId !== userToEdit.id); // Remove user from all classes first
                if (role === 'student' && cls.id === assignedClassId && assignedClassId !== '') {
                    cls.students.push(userToEdit.id); // Add user to the selected class
                }
            });

            // Update in Supabase
            const updated = await updateUserInSupabase(id, { name, role, status: userToEdit.status });
            if (!updated) {
                showToast('Failed to update user in Supabase.', 'error');
                return;
            }
            await refreshUsersFromSupabase();

            showToast('User updated successfully.', 'success');
            addLog(currentUser.id, 'Edit User', `Updated user: ${id}${barcodeChanged ? ` (barcode changed from ${originalId})` : ''}`);
        } else {
            if (mockUsers.some(u => u.id === id)) {
                showToast('A user with this ID already exists.', 'error');
                return;
            }
            const newUser = {
                id: id,
                name: name,
                role: role,
                perms: perms,
                status: 'Active'
            };

            const created = await addUserToSupabase(newUser);
            if (!created) {
                showToast('Failed to add user in Supabase.', 'error');
                return;
            }
            await refreshUsersFromSupabase();

            // Handle New Student Class Assignment
            if (role === 'student' && assignedClassId) {
                const targetClass = studentClasses.find(c => c.id === assignedClassId);
                if (targetClass) {
                    targetClass.students.push(id);
                }
            }

            showToast('User added successfully.', 'success');
            addLog(currentUser.id, 'Add User', `Created new user: ${id}(${role})`);
        }

        closeModal();
        if (document.getElementById('page-users').classList.contains('active')) {
            renderUsers();
        }
    });
}

document.getElementById('add-user-btn')?.addEventListener('click', () => openUserModal());

document.getElementById('view-requests-btn')?.addEventListener('click', () => {
    const rows = helpRequests.map(r => `
        <tr>
            <td><small class="text-muted">${new Date(r.timestamp).toLocaleDateString()}</small></td>
            <td><strong>${r.name}</strong><br><small class="text-muted">${r.email}</small></td>
            <td>${r.description}</td>
            <td><span class="badge" style="background:${r.status === 'Resolved' ? 'rgba(16,185,129,0.2);color:var(--success)' : 'rgba(255,255,255,0.1)'}">${r.status}</span></td>
            <td>
                ${r.status === 'Pending' ? `<button class="btn btn-secondary text-sm resolve-req-btn" data-id="${r.id}">Resolve</button>` : ''}
            </td>
        </tr>
    `).join('') || `<tr><td colspan="5" class="text-center text-muted">No pending requests.</td></tr>`;

    const html = `
        <div class="modal-header">
            <h3>Login & Credential Requests</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
             <table class="data-table">
                <thead><tr><th>Date</th><th>User</th><th>Request</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody id="help-req-tbody">${rows}</tbody>
            </table>
        </div>
    `;

    openModal(html);

    document.querySelectorAll('.resolve-req-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.target.getAttribute('data-id');
            const req = helpRequests.find(r => r.id === reqId);
            if (req) {
                const updated = await updateHelpRequestInSupabase(req.id, 'Resolved');
                if (!updated) {
                    showToast('Failed to resolve request in Supabase.', 'error');
                    return;
                }
                await refreshRequestsFromSupabase();
                showToast('Request marked as resolved.', 'success');
                closeModal();
                document.getElementById('view-requests-btn').click(); // refresh modal
            }
        });
    });
});

function normalizeImportText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeImportCell(value) {
    return String(value || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/""/g, '"')
        .trim();
}

function parseCsvRow(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (ch === ',' && !inQuotes) {
            cells.push(current);
            current = '';
            continue;
        }

        current += ch;
    }

    cells.push(current);
    return cells.map(normalizeImportCell);
}

function extractCourseOptionFromClassName(className) {
    return String(className || '')
        .replace(/^grade\s*(k|\d{1,2})\s*[-: ]\s*/i, '')
        .replace(/\s*[-: ]\s*grade\s*(k|\d{1,2})$/i, '')
        .trim();
}

function composeClassNameFromCourseAndGrade(course, grade) {
    const c = String(course || '').trim();
    const g = String(grade || '').trim();
    if (c && g) return `${c} - Grade ${g}`;
    if (c) return c;
    if (g) return `Grade ${g}`;
    return '';
}

function findClassByCourseAndGrade(course, grade) {
    const c = String(course || '').trim();
    const g = String(grade || '').trim();
    if (!c && !g) return null;

    const normalizedCourse = normalizeImportText(c);
    const normalizedGrade = normalizeImportText(g);
    const exactCandidates = new Set([
        composeClassNameFromCourseAndGrade(c, g),
        (c && g) ? `Grade ${g} ${c}` : '',
        (c && g) ? `${c} ${g}` : '',
        c
    ].filter(Boolean).map(name => normalizeImportText(name)));

    const exactMatch = studentClasses.find(cls => exactCandidates.has(normalizeImportText(cls.name)));
    if (exactMatch) return exactMatch;

    if (normalizedCourse && normalizedGrade) {
        return studentClasses.find(cls => {
            const normalizedName = normalizeImportText(cls.name);
            return normalizedName.includes(normalizedCourse) && normalizedName.includes(normalizedGrade);
        }) || null;
    }

    if (normalizedCourse) {
        return studentClasses.find(cls => normalizeImportText(cls.name).includes(normalizedCourse)) || null;
    }

    if (normalizedGrade) {
        return studentClasses.find(cls => normalizeImportText(cls.name).includes(normalizedGrade)) || null;
    }

    return null;
}

document.getElementById('bulk-users-btn')?.addEventListener('click', () => {
    const gradeOptions = ['10', '11', '12'];
    const courseOptions = [...new Set(
        studentClasses
            .map(cls => extractCourseOptionFromClassName(cls.name))
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));

    const html = `
        <div class="modal-header">
            <h3>Bulk Import Users</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Paste comma-separated user data in the format:<br><strong>ID,Name,Role,Course,Grade</strong></p>
            <div class="form-group" style="display:grid;grid-template-columns:1fr 150px;gap:0.75rem;align-items:end;">
                <div>
                    <label>Default Course (optional)</label>
                    <input list="bulk-course-options" id="bulk-default-course" class="form-control" placeholder="e.g. Biology">
                    <datalist id="bulk-course-options">
                        ${courseOptions.map(course => `<option value="${course}"></option>`).join('')}
                    </datalist>
                </div>
                <div>
                    <label>Default Grade (optional)</label>
                    <select id="bulk-default-grade" class="form-control">
                        <option value="">None</option>
                        ${gradeOptions.map(g => `<option value="${g}">${g}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group" style="margin-top:0.75rem;">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
                    <input type="checkbox" id="bulk-autocreate-class" checked>
                    Auto-create class when Course/Grade does not match an existing class
                </label>
            </div>
            <div class="form-group">
                <textarea id="bulk-users-data" class="form-control" rows="6" placeholder="STU-001,Alice Smith,student,Biology,10\nTCH-002,Bob Jones,teacher,,"></textarea>
            </div>
            <p class="text-sm text-muted">Roles must be 'student', 'teacher', or 'developer'. Existing IDs are skipped. Course/Grade applies to students only.</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-bulk-btn">Import Users</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-bulk-btn').addEventListener('click', async () => {
        const data = document.getElementById('bulk-users-data').value.trim();
        if (!data) {
            showToast('Please enter data to import.', 'error');
            return;
        }

        const defaultCourse = document.getElementById('bulk-default-course').value.trim();
        const defaultGrade = document.getElementById('bulk-default-grade').value.trim();
        const autoCreateClass = document.getElementById('bulk-autocreate-class').checked;

        const lines = data.split('\n');
        let importCount = 0;
        let skipCount = 0;
        let invalidCount = 0;
        let assignedCount = 0;
        let unassignedCount = 0;
        let createdClassCount = 0;
        const classesToPersist = new Set();
        const seenIds = new Set(mockUsers.map(u => String(u.id || '').trim().toUpperCase()));
        const roleMap = {
            student: 'student',
            students: 'student',
            teacher: 'teacher',
            teachers: 'teacher',
            developer: 'developer',
            developers: 'developer',
            dev: 'developer'
        };

        for (const line of lines) {
            const parts = parseCsvRow(line);
            if (parts.every(part => !part)) continue;

            const maybeHeader = parts.map(normalizeImportText);
            if (maybeHeader[0] === 'id' && maybeHeader[1] === 'name' && maybeHeader[2] === 'role') {
                continue;
            }

            if (parts.length < 3) {
                invalidCount++;
                continue;
            }

            const id = normalizeImportCell(parts[0]).toUpperCase();
            const name = normalizeImportCell(parts[1]);
            const roleRaw = normalizeImportText(parts[2]);
            const role = roleMap[roleRaw] || roleRaw;
            const course = normalizeImportCell(parts[3] || '') || defaultCourse;
            const grade = normalizeImportCell(parts[4] || '') || defaultGrade;

            if (!id || !name || !['student', 'teacher', 'developer'].includes(role)) {
                invalidCount++;
                continue;
            }

            if (seenIds.has(id)) {
                skipCount++;
                continue;
            }

            const created = await addUserToSupabase({
                id,
                name,
                role,
                status: 'Active'
            });

            if (!created) {
                invalidCount++;
                continue;
            }

            seenIds.add(id);
            importCount++;

            if (role === 'student') {
                let targetClass = findClassByCourseAndGrade(course, grade);

                if (!targetClass && autoCreateClass && (course || grade)) {
                    const newClassName = composeClassNameFromCourseAndGrade(course, grade);
                    if (newClassName) {
                        targetClass = {
                            id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : generateId('CLS'),
                            name: newClassName,
                            teacherId: currentUser.id,
                            students: [],
                            visibleItemIds: [],
                            allowedVisibilityTags: [],
                            duePolicy: normalizeDuePolicy(defaultDuePolicy),
                            defaultPermissions: { canCreateProjects: false, canJoinProjects: true, canSignOut: true }
                        };
                        studentClasses.unshift(targetClass);
                        createdClassCount++;
                    }
                }

                if (targetClass) {
                    if (!targetClass.students.includes(id)) {
                        targetClass.students.push(id);
                    }
                    classesToPersist.add(targetClass);
                    assignedCount++;
                } else {
                    unassignedCount++;
                }
            }
        }

        let classPersistFailures = 0;
        for (const cls of classesToPersist) {
            const saved = await saveStudentClassToSupabase(cls);
            if (!saved) classPersistFailures++;
        }

        await Promise.all([
            refreshUsersFromSupabase(),
            loadStudentClasses()
        ]);

        if (importCount > 0) {
            const classSummary = ` | Class assigned: ${assignedCount} | Unassigned: ${unassignedCount} | New classes: ${createdClassCount}`;
            const warningSummary = classPersistFailures > 0 ? ` | Class save issues: ${classPersistFailures}` : '';
            showToast(`Imported ${importCount} users. (${skipCount} skipped, ${invalidCount} invalid)${classSummary}${warningSummary}`, classPersistFailures > 0 ? 'warning' : 'success');
            addLog(currentUser.id, 'Bulk Import', `Imported ${importCount} users. Assigned classes for ${assignedCount} students. Created ${createdClassCount} classes.`);
        } else {
            showToast('No valid new users found to import.', 'error');
        }

        closeModal();
        if (document.getElementById('page-users').classList.contains('active')) {
            renderUsers();
        }
    });
});

document.getElementById('bulk-delete-users-btn')?.addEventListener('click', async () => {
    const selectedCbs = Array.from(document.querySelectorAll('.user-select-cb:checked'));
    if (selectedCbs.length === 0) {
        showToast('Please select users to delete using the checkboxes on the left.', 'error');
        return;
    }

    const selectedIds = selectedCbs.map(cb => cb.getAttribute('data-id'));
    const targetUsers = mockUsers.filter(u => selectedIds.includes(u.id));
    
    // Teachers cannot delete developers
    if (currentUser.role === 'teacher') {
        const developerCount = targetUsers.filter(u => u.role === 'developer').length;
        if (developerCount > 0) {
            showToast(`Teachers cannot delete developers. ${developerCount} developer(s) excluded from deletion.`, 'error');
            return;
        }
    }

    if (confirm(`Are you absolutely sure you want to PERMANENTLY delete ${targetUsers.length} selected user(s)? This cannot be undone.`)) {
        let deleteCount = 0;
        const deletingCurrentUser = targetUsers.some(u => u.id === currentUser?.id);

        for (const u of targetUsers) {
            const deleted = await deleteUserFromSupabase(u.id);
            if (deleted) {
                deleteCount++;
                // Keep class lists consistent in-memory.
                studentClasses.forEach(cls => {
                    cls.students = cls.students.filter(sId => sId !== u.id);
                    if (cls.teacherId === u.id) cls.teacherId = null;
                });
            }
        }

        await refreshUsersFromSupabase();

        showToast(`Successfully deleted ${deleteCount} users.`, 'success');
        addLog(currentUser.id, 'Bulk Delete', `Deleted ${deleteCount} users via selection.`);

        if (deletingCurrentUser) {
            returnToLoginView({ message: 'Your account was deleted. Session ended.' });
            return;
        }

        renderUsers();
    }
});

document.getElementById('bulk-suspend-users-btn')?.addEventListener('click', async () => {
    const selectedCbs = Array.from(document.querySelectorAll('.user-select-cb:checked'));
    if (selectedCbs.length === 0) {
        showToast('Please select users to suspend using the checkboxes on the left.', 'error');
        return;
    }

    const selectedIds = selectedCbs.map(cb => cb.getAttribute('data-id'));
    const targetUsers = mockUsers.filter(u => selectedIds.includes(u.id) && u.role === 'student' && u.id !== currentUser?.id);

    if (targetUsers.length === 0) {
        showToast('Only students can be suspended. No eligible students were selected.', 'error');
        return;
    }

    const userNames = targetUsers.map(u => u.name).join('\n• ');
    const promptMsg = targetUsers.length === 1
        ? `Are you sure you want to change the suspension status for ${targetUsers[0].name}?`
        : `Are you sure you want to change the suspension status for these ${targetUsers.length} students?\n\n• ${userNames}`;

    if (confirm(promptMsg)) {
        let suspendCount = 0;
        let activateCount = 0;
        for (const u of targetUsers) {
            if (u.status === 'Suspended') {
                await updateUserInSupabase(u.id, { status: 'Active' });
                activateCount++;
            } else {
                await updateUserInSupabase(u.id, { status: 'Suspended' });
                suspendCount++;
            }
        }

        await refreshUsersFromSupabase();

        showToast(`Updated status for ${targetUsers.length} students (${suspendCount} suspended, ${activateCount} activated).`, 'success');
        addLog(currentUser.id, 'Bulk Suspend', `Changed suspension for ${targetUsers.length} students via selection.`);
        renderUsers();
    }
});


/* =======================================
   MODAL & NOTIFICATION HELPERS
   ======================================= */
function openModal(contentHtml) {
    dynamicModal.classList.remove('debug-modal', 'class-modal');
    dynamicModal.innerHTML = contentHtml;
    modalContainer.classList.remove('hidden');
}

function closeModal() {
    modalContainer.classList.add('hidden');
    dynamicModal.innerHTML = '';
    dynamicModal.classList.remove('debug-modal', 'class-modal');
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? 'ph-check-circle' : type === 'error' ? 'ph-warning-circle' : 'ph-info';

    toast.innerHTML = `
        <i class="ph ${icon}" style="font-size:1.5rem"></i>
        <span>${message}</span>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Close Modal on outside click
modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
        closeModal();
    }
});

// Setup Add Item flow
document.getElementById('add-item-btn')?.addEventListener('click', openAddItemModal);

function openAddItemModal() {
    const categoryOptions = categories.length > 0
        ? categories.map(c => `<option value="${c}">${c}</option>`).join('')
        : '<option value="Uncategorized">Uncategorized</option>';

    const tagCheckboxes = visibilityTags.map(tag =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem">
            <input type="checkbox" class="add-item-tag-cb" value="${tag}"> ${tag}
        </label>`
    ).join('');

    const html = `
        <div class="modal-header">
            <h3>Add New Item</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Item Name</label>
                <input type="text" id="add-name" class="form-control" placeholder="e.g. Servo Motor">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select id="add-category" class="form-control">
                    ${categoryOptions}
                </select>
                ${categories.length === 0 ? '<small class="text-muted">No categories found yet. This item will be saved as Uncategorized.</small>' : ''}
            </div>
            <div class="form-group">
                <label>SKU / Barcode</label>
                <input type="text" id="add-sku" class="form-control" placeholder="Leave blank to auto-generate">
            </div>
            <div class="form-group">
                <label>Part Number (Optional)</label>
                <input type="text" id="add-part-number" class="form-control" placeholder="e.g. SRM-42-001">
            </div>
            <div class="form-group">
                <label>Item Type</label>
                <select id="add-item-type" class="form-control">
                    <option value="item">Item (Tracked, Sign In/Out)</option>
                    <option value="consumable">Consumable (No Stock Tracking)</option>
                </select>
                <small class="text-muted">Items are tracked with sign-in/out. Consumables don't show stock levels.</small>
            </div>
            <div class="grid-2-col" style="gap:1rem">
                <div class="form-group">
                    <label>Initial Stock</label>
                    <input type="number" id="add-stock" class="form-control" value="0">
                </div>
                <div class="form-group">
                    <label>Low Threshold</label>
                    <input type="number" id="add-threshold" class="form-control" value="5">
                </div>
            </div>
            <div class="form-group">
                <label>Visibility</label>
                <select id="add-visibility-level" class="form-control">
                    <option value="standard">Standard (Class-based visibility)</option>
                    <option value="low">Low (Limited visibility)</option>
                    <option value="hidden">Hidden (Not visible to students)</option>
                </select>
                <small class="text-muted">Controls who can see this item based on class or role.</small>
            </div>
            <div class="form-group">
                <label>Visibility Tags</label>
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Leave all unchecked to make the item visible to all classes.</small>
                <div class="glass-panel" style="padding:0.75rem">
                    ${tagCheckboxes || '<p class="text-muted text-sm">No visibility tags defined.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-item">Add Item</button>
        </div>
    `;

    openModal(html);

    const submitBtn = document.getElementById('confirm-add-item');
    submitBtn?.addEventListener('click', () => {
        withButtonPending(submitBtn, 'Adding...', async () => {
        const name = document.getElementById('add-name').value.trim();
        const category = (document.getElementById('add-category').value || 'Uncategorized').trim();
        const manualSku = document.getElementById('add-sku').value.trim().toUpperCase();
        const partNumber = document.getElementById('add-part-number')?.value.trim() || '';
        const itemType = document.getElementById('add-item-type')?.value || 'item';
        const visibilityLevel = document.getElementById('add-visibility-level')?.value || 'standard';
        const stock = Math.max(0, parseInt(document.getElementById('add-stock').value, 10) || 0);
        const threshold = Math.max(0, parseInt(document.getElementById('add-threshold').value, 10) || 0);
        const selectedTags = Array.from(document.querySelectorAll('.add-item-tag-cb:checked')).map(cb => cb.value);

        if (!name) {
            showToast('Item name is required.', 'error');
            return;
        }

        const autoSku = `${name.substring(0, 3).toUpperCase()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        const newItem = {
            id: generateId('ITM'),
            name,
            category,
            sku: manualSku || autoSku,
            stock,
            threshold,
            part_number: partNumber || null,
            item_type: itemType,
            visibility_level: visibilityLevel,
            visibilityTags: selectedTags
        };

        const createdItem = await addItemToSupabase(newItem);
        if (!createdItem) {
            showToast('Failed to add item in Supabase.', 'error');
            return;
        }

        const persistedItemId = createdItem.id || newItem.id;
        const tagsSaved = await setItemVisibilityTagsInSupabase(persistedItemId, selectedTags);
        if (!tagsSaved) {
            showToast('Item created, but visibility tags failed to save.', 'warning');
        }

        await refreshInventoryFromSupabase();
        addLog(currentUser.id, 'Add Item', `Added new inventory item: ${name} (${stock} units)`);
        showToast(`${name} added to inventory.`, 'success');
        closeModal();
            if (document.getElementById('page-inventory').classList.contains('active')) {
                renderInventory();
            }
        });
    });
}

function openEditProjectModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    if (!canCurrentUserManageProject(project)) {
        showToast('Only project owners, teachers, or developers can edit this project.', 'error');
        return;
    }

    const canAssignOwner = currentUser.role !== 'student';
    const ownerCandidates = getProjectStudentCandidates();
    const ownerOptions = ownerCandidates.map(student =>
        `<option value="${student.id}" ${student.id === project.ownerId ? 'selected' : ''}>${student.name} (${student.id})</option>`
    ).join('');

    const collaboratorOptions = buildProjectCollaboratorOptions({
        selectedOwnerId: project.ownerId,
        selectedCollaborators: project.collaborators || []
    });

    const html = `
        <div class="modal-header">
            <h3>Edit Project: ${project.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Project Name</label>
                <input type="text" id="edit-proj-name" class="form-control" value="${project.name}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="edit-proj-desc" class="form-control" rows="3">${project.description}</textarea>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select id="edit-proj-status" class="form-control">
                    <option value="Active" ${project.status === 'Active' ? 'selected' : ''}>Active</option>
                    <option value="Completed" ${project.status === 'Completed' ? 'selected' : ''}>Completed</option>
                    <option value="Archived" ${project.status === 'Archived' ? 'selected' : ''}>Archived</option>
                </select>
            </div>
            ${canAssignOwner ? `
            <div class="form-group">
                <label>Project Owner</label>
                <select id="edit-proj-owner" class="form-control">
                    ${ownerOptions || '<option value="">No students found</option>'}
                </select>
                <small class="text-muted">Teachers and developers can assign ownership to a student.</small>
            </div>` : ''}
            <div class="form-group">
                <label>Student Collaborators</label>
                <div id="edit-proj-collaborators-wrap" class="glass-panel" style="padding:1rem; max-height:180px; overflow-y:auto">
                    ${collaboratorOptions || '<p class="text-sm text-muted">No eligible student collaborators.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-proj">Save Changes</button>
        </div>
    `;

    openModal(html);

    const ownerSelect = document.getElementById('edit-proj-owner');
    ownerSelect?.addEventListener('change', () => {
        const wrapper = document.getElementById('edit-proj-collaborators-wrap');
        if (!wrapper) return;
        wrapper.innerHTML = buildProjectCollaboratorOptions({
            selectedOwnerId: ownerSelect.value,
            selectedCollaborators: project.collaborators || []
        }) || '<p class="text-sm text-muted">No eligible student collaborators.</p>';
    });

    document.getElementById('confirm-edit-proj').addEventListener('click', async () => {
        const name = document.getElementById('edit-proj-name').value.trim();
        const desc = document.getElementById('edit-proj-desc').value.trim();
        const status = document.getElementById('edit-proj-status').value;
        const selectedOwnerId = canAssignOwner
            ? (document.getElementById('edit-proj-owner')?.value || project.ownerId)
            : project.ownerId;
        const collaborators = Array.from(document.querySelectorAll('#edit-proj-collaborators-wrap .proj-student-checkbox:checked')).map(cb => cb.value);

        if (!selectedOwnerId) {
            showToast('Please select a project owner.', 'error');
            return;
        }

        if (name) {
            const updated = await updateProjectInSupabase(project.id, {
                name,
                owner_id: selectedOwnerId,
                description: desc,
                status
            });
            if (!updated) {
                showToast('Failed to update project in Supabase.', 'error');
                return;
            }

            const collaboratorsSaved = await syncProjectCollaboratorsInSupabase(project.id, collaborators, project.collaborators || []);
            if (!collaboratorsSaved) {
                showToast('Project updated, but collaborator sync failed.', 'warning');
            }

            await refreshProjectsFromSupabase();

            addLog(currentUser.id, 'Edit Project', `Updated project: ${name} (owner ${selectedOwnerId}, ${collaborators.length} collaborators)`);
            showToast(`Project updated.`, 'success');
            closeModal();
            if (document.getElementById('page-projects').classList.contains('active')) {
                renderProjects();
            }
        }
    });
}

// Create Project Flow
document.getElementById('create-project-btn')?.addEventListener('click', () => {
    const canAssignOwner = currentUser.role !== 'student';
    const ownerCandidates = getProjectStudentCandidates();
    const defaultOwnerId = canAssignOwner
        ? (ownerCandidates[0]?.id || '')
        : currentUser.id;

    const ownerOptions = ownerCandidates.map(student =>
        `<option value="${student.id}" ${student.id === defaultOwnerId ? 'selected' : ''}>${student.name} (${student.id})</option>`
    ).join('');

    const collaboratorOptions = buildProjectCollaboratorOptions({ selectedOwnerId: defaultOwnerId });

    const html = `
        <div class="modal-header">
            <h3>Create New Project</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Project Name</label>
                <input type="text" id="add-proj-name" class="form-control" placeholder="e.g. Drone Build">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="add-proj-desc" class="form-control" rows="3" placeholder="Brief details about the project..."></textarea>
            </div>
            ${canAssignOwner ? `
            <div class="form-group">
                <label>Project Owner</label>
                <select id="add-proj-owner" class="form-control">
                    ${ownerOptions || '<option value="">No students found</option>'}
                </select>
                <small class="text-muted">Teachers and developers can create projects directly for students.</small>
            </div>` : ''}
            <div class="form-group">
                <label>Add Student Collaborators (Optional)</label>
                <div id="add-proj-collaborators-wrap" class="glass-panel" style="padding:1rem; max-height:150px; overflow-y:auto">
                    ${collaboratorOptions || '<p class="text-sm text-muted">No available student collaborators.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-proj">Create Project</button>
        </div>
    `;

    openModal(html);

    const ownerSelect = document.getElementById('add-proj-owner');
    ownerSelect?.addEventListener('change', () => {
        const wrap = document.getElementById('add-proj-collaborators-wrap');
        if (!wrap) return;
        wrap.innerHTML = buildProjectCollaboratorOptions({ selectedOwnerId: ownerSelect.value })
            || '<p class="text-sm text-muted">No available student collaborators.</p>';
    });

    document.getElementById('confirm-add-proj').addEventListener('click', () => {
        const submitBtn = document.getElementById('confirm-add-proj');
        withButtonPending(submitBtn, 'Creating...', async () => {
            const name = document.getElementById('add-proj-name').value.trim();
            const desc = document.getElementById('add-proj-desc').value.trim();
            const ownerId = canAssignOwner
                ? (document.getElementById('add-proj-owner')?.value || '')
                : currentUser.id;
            const collaborators = Array.from(document.querySelectorAll('#add-proj-collaborators-wrap .proj-student-checkbox:checked')).map(cb => cb.value);

            if (!ownerId) {
                showToast('Please select a project owner.', 'error');
                return;
            }

            if (name) {
                const newProject = {
                    id: generateId('PRJ'),
                    name: name,
                    ownerId,
                    description: desc,
                    collaborators: collaborators,
                    status: 'Active',
                    itemsOut: []
                };

                const created = await addProjectToSupabase(newProject);
                if (!created) {
                    showToast('Failed to create project in Supabase.', 'error');
                    return;
                }

                for (const collaboratorId of collaborators) {
                    await addProjectCollaboratorToSupabase(newProject.id, collaboratorId);
                }

                await refreshProjectsFromSupabase();

                addLog(currentUser.id, 'Create Project', `Created new project: ${name} for ${ownerId} with ${collaborators.length} collaborators.`);
                showToast(`Project ${name} created.`, 'success');
                closeModal();
                if (document.getElementById('page-projects').classList.contains('active')) {
                    renderProjects();
                }
            }
        });
    });
});

/* =======================================
   ORDERS LOGIC
   ======================================= */
function openOrderRequestModal({ initialName = '' } = {}) {
    if (!currentUser) return;

    const html = `
        <div class="modal-header">
            <h3>Request Item for Order</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Use this when an item does not exist in inventory or stock is unavailable.</p>
            <div class="form-group">
                <label>Item Name</label>
                <input type="text" id="order-item-name" class="form-control" placeholder="e.g. Soldering Iron" value="${String(initialName || '').replace(/"/g, '&quot;')}">
            </div>
            <div class="form-group">
                <label>Category</label>
                <input type="text" id="order-item-category" class="form-control" placeholder="e.g. Electronics">
            </div>
            <div class="form-group">
                <label>Quantity</label>
                <input type="number" id="order-item-qty" class="form-control" min="1" value="1">
            </div>
            <div class="form-group">
                <label>Why is this needed?</label>
                <textarea id="order-item-justification" class="form-control" rows="4" placeholder="Class/project need, urgency, usage details..."></textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="submit-order-request-btn">Submit Request</button>
        </div>
    `;

    openModal(html);

    document.getElementById('submit-order-request-btn')?.addEventListener('click', async () => {
        const itemName = document.getElementById('order-item-name')?.value.trim();
        const category = document.getElementById('order-item-category')?.value.trim() || 'Uncategorized';
        const quantity = Math.max(1, parseInt(document.getElementById('order-item-qty')?.value, 10) || 1);
        const justification = document.getElementById('order-item-justification')?.value.trim();

        if (!itemName || !justification) {
            showToast('Item name and justification are required.', 'error');
            return;
        }

        const request = {
            id: generateId('ORD'),
            requestedByUserId: currentUser.id,
            requestedByName: currentUser.name,
            itemName,
            category,
            quantity,
            justification,
            status: 'Pending',
            timestamp: new Date().toISOString()
        };

        const created = await addOrderRequestToSupabase(request);
        if (!created) {
            showToast('Failed to submit order request to Supabase.', 'error');
            return;
        }

        await refreshRequestsFromSupabase();
        addLog(currentUser.id, 'Order Request', `Requested order: ${quantity}x ${itemName} (${category})`);
        showToast('Order request submitted.', 'success');
        closeModal();

        if (document.getElementById('page-orders')?.classList.contains('active')) {
            renderOrders();
        }
    });
}

function renderOrders() {
    const tbody = document.getElementById('orders-table-body');
    const filter = document.getElementById('orders-status-filter');
    const toggleWrap = document.getElementById('orders-student-toggle-wrap');
    const toggle = document.getElementById('orders-student-visible-toggle');
    const newOrderBtn = document.getElementById('new-order-request-btn');

    if (!tbody || !currentUser) return;

    if (toggleWrap) {
        toggleWrap.style.display = currentUser.role === 'student' ? 'none' : '';
    }

    if (toggle) {
        toggle.checked = ordersStudentViewEnabled;
        if (!toggle.dataset.bound) {
            toggle.addEventListener('change', () => {
                persistOrdersStudentViewSetting(toggle.checked);
                applyOrdersNavVisibility();
                addLog(currentUser.id, 'Orders Settings', `Student orders view ${ordersStudentViewEnabled ? 'enabled' : 'disabled'}`);
                showToast(`Student order view ${ordersStudentViewEnabled ? 'enabled' : 'disabled'}.`, 'success');
            });
            toggle.dataset.bound = '1';
        }
    }

    if (newOrderBtn && !newOrderBtn.dataset.bound) {
        newOrderBtn.addEventListener('click', () => openOrderRequestModal());
        newOrderBtn.dataset.bound = '1';
    }

    if (currentUser.role === 'student' && !ordersStudentViewEnabled) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Orders view is currently disabled for students.</td></tr>';
        return;
    }

    const selectedStatus = filter?.value || 'all';
    const source = currentUser.role === 'student'
        ? orderRequests.filter(r => r.requestedByUserId === currentUser.id)
        : orderRequests;

    const rows = selectedStatus === 'all'
        ? source
        : source.filter(r => r.status === selectedStatus);

    tbody.innerHTML = rows.map(r => {
        const statusStyle = r.status === 'Approved' || r.status === 'Ordered'
            ? 'background:rgba(16,185,129,0.2);color:var(--success)'
            : r.status === 'Denied'
                ? 'background:rgba(239,68,68,0.2);color:var(--danger)'
                : 'background:rgba(245,158,11,0.2);color:var(--warning)';

        const canModerate = currentUser.role !== 'student' && r.status === 'Pending';

        return `
            <tr>
                <td><small class="text-muted">${new Date(r.timestamp).toLocaleDateString()}</small></td>
                <td>${r.requestedByName || r.requestedByUserId}</td>
                <td><strong>${r.itemName}</strong></td>
                <td>${r.category || 'Uncategorized'}</td>
                <td>${r.quantity || 1}</td>
                <td>${r.justification || ''}</td>
                <td><span class="badge" style="${statusStyle}">${r.status}</span></td>
                <td>
                    ${canModerate ? `
                        <button class="btn btn-secondary text-sm approve-order-btn" data-id="${r.id}" style="padding:0.3rem 0.6rem;font-size:0.75rem;margin-right:0.25rem;">Approve</button>
                        <button class="btn btn-danger text-sm deny-order-btn" data-id="${r.id}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">Deny</button>
                    ` : '-'}
                </td>
            </tr>
        `;
    }).join('') || '<tr><td colspan="8" class="text-center text-muted">No order requests found.</td></tr>';

    document.querySelectorAll('.approve-order-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = orderRequests.find(r => r.id === reqId);
            if (!req) return;

            const updated = await updateOrderRequestInSupabase(reqId, 'Approved');
            if (!updated) {
                showToast('Failed to approve order request.', 'error');
                return;
            }

            await refreshRequestsFromSupabase();
            addLog(currentUser.id, 'Approve Order Request', `Approved order request for ${req.itemName} (${req.quantity})`);
            showToast('Order request approved.', 'success');
            renderOrders();
        });
    });

    document.querySelectorAll('.deny-order-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = orderRequests.find(r => r.id === reqId);
            if (!req) return;

            const updated = await updateOrderRequestInSupabase(reqId, 'Denied');
            if (!updated) {
                showToast('Failed to deny order request.', 'error');
                return;
            }

            await refreshRequestsFromSupabase();
            addLog(currentUser.id, 'Deny Order Request', `Denied order request for ${req.itemName} (${req.quantity})`);
            showToast('Order request denied.', 'success');
            renderOrders();
        });
    });
}

document.getElementById('orders-status-filter')?.addEventListener('change', () => renderOrders());

/* =======================================
   REQUESTS LOGIC
   ======================================= */
function renderRequests() {
    const tbody = document.getElementById('requests-table-body');
    if (!tbody) return;

    // Combine help requests and extension requests
    const allRequests = [];

    helpRequests.forEach(r => {
        allRequests.push({
            id: r.id,
            type: 'Credential',
            from: r.name,
            details: r.description,
            status: r.status,
            timestamp: r.timestamp,
            sourceArray: 'help',
            sourceObj: r
        });
    });

    extensionRequests.forEach(r => {
        allRequests.push({
            id: r.id,
            type: 'Extension',
            from: r.userName,
            details: `${r.itemName} in ${r.projectName} — Due: ${new Date(r.currentDue).toLocaleDateString()} → ${new Date(r.requestedDue).toLocaleDateString()}`,
            status: r.status,
            timestamp: r.timestamp,
            sourceArray: 'extension',
            sourceObj: r
        });
    });

    // Sort by timestamp descending
    allRequests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Filter out non-pending requests
    const pendingRequests = allRequests.filter(r => r.status === 'Pending');

    tbody.innerHTML = pendingRequests.map(r => {
        const statusStyle = r.status === 'Approved' ? 'background:rgba(16,185,129,0.2);color:var(--success)' :
            r.status === 'Denied' ? 'background:rgba(239,68,68,0.2);color:var(--danger)' :
                r.status === 'Resolved' ? 'background:rgba(16,185,129,0.2);color:var(--success)' :
                    'background:rgba(255,255,255,0.1)';
        return `
        <tr>
            <td><small class="text-muted">${new Date(r.timestamp).toLocaleDateString()}</small></td>
            <td><span class="badge" style="background: rgba(139,92,246,0.15); color: var(--accent-primary)">${r.type}</span></td>
            <td><strong>${r.from}</strong></td>
            <td>${r.details}</td>
            <td><span class="badge" style="${statusStyle}">${r.status}</span></td>
            <td>
                ${r.status === 'Pending' ? `
                    ${r.sourceArray === 'extension' ? `
                        <button class="btn btn-secondary text-sm approve-req-btn" data-id="${r.id}" data-type="${r.sourceArray}" style="padding:0.3rem 0.6rem;font-size:0.75rem;margin-right:0.25rem;">Approve</button>
                        <button class="btn btn-danger text-sm deny-req-btn" data-id="${r.id}" data-type="${r.sourceArray}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">Deny</button>
                    ` : `
                        <button class="btn btn-secondary text-sm resolve-req-btn2" data-id="${r.id}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">Resolve</button>
                    `}
                ` : ''}
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="6" class="text-center text-muted">No pending requests.</td></tr>`;

    // Bind resolve buttons for help requests
    document.querySelectorAll('.resolve-req-btn2').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = helpRequests.find(r => r.id === reqId);
            if (req) {
                const updated = await updateHelpRequestInSupabase(req.id, 'Resolved');
                if (!updated) {
                    showToast('Failed to resolve help request in Supabase.', 'error');
                    return;
                }
                await refreshRequestsFromSupabase();
                showToast('Help request resolved.', 'success');
                addLog(currentUser.id, 'Resolve Request', `Resolved credential request from ${req.name}`);
                renderRequests();
            }
        });
    });

    // Bind approve/deny for extension requests
    document.querySelectorAll('.approve-req-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = extensionRequests.find(r => r.id === reqId);
            if (req) {
                const updated = await updateExtensionRequestInSupabase(req.id, 'Approved');
                if (!updated) {
                    showToast('Failed to approve extension request in Supabase.', 'error');
                    return;
                }

                // Actual date extension: find item in projects and extend the due date
                const dueUpdatePromises = [];
                projects.forEach(p => {
                    p.itemsOut.forEach(io => {
                        if (io.itemId === req.itemId && io.dueDate === req.currentDue) {
                            io.dueDate = req.requestedDue;
                            if (io.id) {
                                dueUpdatePromises.push(updateProjectItemOutDueDateInSupabase(io.id, req.requestedDue));
                            }
                        }
                    });
                });

                await Promise.all(dueUpdatePromises);
                await Promise.all([
                    refreshRequestsFromSupabase(),
                    refreshProjectsFromSupabase()
                ]);

                showToast(`Extension approved for ${req.itemName}.`, 'success');
                addLog(currentUser.id, 'Approve Extension', `Approved extension for ${req.itemName} requested by ${req.userName}`);
                renderRequests();
            }
        });
    });

    document.querySelectorAll('.deny-req-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = extensionRequests.find(r => r.id === reqId);
            if (req) {
                const updated = await updateExtensionRequestInSupabase(req.id, 'Denied');
                if (!updated) {
                    showToast('Failed to deny extension request in Supabase.', 'error');
                    return;
                }
                await refreshRequestsFromSupabase();
                showToast(`Extension denied for ${req.itemName}.`, 'success');
                addLog(currentUser.id, 'Deny Extension', `Denied extension for ${req.itemName} requested by ${req.userName}`);
                renderRequests();
            }
        });
    });
}

/* =======================================
   EDIT ITEM MODAL
   ======================================= */
function openEditItemModal(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const categoryOptions = categories.map(c =>
        `<option value="${c}" ${item.category === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    const itemTagSet = new Set(item.visibilityTags || []);
    const tagOptions = visibilityTags.map(tag =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem">
            <input type="checkbox" class="edit-item-tag-cb" value="${tag}" ${itemTagSet.has(tag) ? 'checked' : ''}> ${tag}
        </label>`
    ).join('');

    const html = `
        <div class="modal-header">
            <h3>Edit Item: ${item.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Item Name</label>
                <input type="text" id="edit-item-name" class="form-control" value="${item.name}">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select id="edit-item-category" class="form-control">
                    ${categoryOptions}
                </select>
            </div>
            <div class="form-group">
                <label>SKU</label>
                <input type="text" id="edit-item-sku" class="form-control" value="${item.sku}">
            </div>
            <div class="grid-2-col" style="gap:1rem">
                <div class="form-group">
                    <label>Stock</label>
                    <input type="number" id="edit-item-stock" class="form-control" value="${item.stock}">
                </div>
                <div class="form-group">
                    <label>Low Threshold</label>
                    <input type="number" id="edit-item-threshold" class="form-control" value="${item.threshold}">
                </div>
            </div>
            <div class="form-group">
                <label>Visibility Tags</label>
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Control which classes can see this item based on their allowed tags. Items with no tags are always visible.</small>
                <div class="glass-panel" style="padding:0.75rem">
                    ${tagOptions || '<p class="text-muted text-sm">No visibility tags defined. Use Manage Visibility Tags to create some.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-item">Save Changes</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-edit-item').addEventListener('click', async () => {
        const name = document.getElementById('edit-item-name').value.trim();
        const category = document.getElementById('edit-item-category').value;
        const sku = document.getElementById('edit-item-sku').value.trim();
        const stock = parseInt(document.getElementById('edit-item-stock').value) || 0;
        const threshold = parseInt(document.getElementById('edit-item-threshold').value) || 0;
        const selectedTags = Array.from(document.querySelectorAll('.edit-item-tag-cb:checked')).map(cb => cb.value);

        if (name) {
            const updated = await updateItemInSupabase(itemId, {
                name,
                category,
                sku,
                stock,
                threshold
            });
            if (!updated) {
                showToast('Failed to update item in Supabase.', 'error');
                return;
            }

            const tagsUpdated = await setItemVisibilityTagsInSupabase(itemId, selectedTags);
            if (!tagsUpdated) {
                showToast('Item updated, but visibility tags failed to save.', 'warning');
            }

            await refreshInventoryFromSupabase();

            addLog(currentUser.id, 'Edit Item', `Updated item: ${name} (${itemId})`);
            showToast(`${name} updated.`, 'success');
            closeModal();
            if (document.getElementById('page-inventory').classList.contains('active')) {
                renderInventory();
            }
        } else {
            showToast('Item name is required.', 'error');
        }
    });
}

/* =======================================
   BULK IMPORT ITEMS
   ======================================= */
document.getElementById('bulk-import-items-btn')?.addEventListener('click', () => {
    const html = `
        <div class="modal-header">
            <h3>Bulk Import Items</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Paste comma-separated item data in the format:<br><strong>Name,Category,SKU,Stock,Threshold</strong></p>
            <div class="form-group">
                <textarea id="bulk-items-data" class="form-control" rows="6" placeholder="Servo Motor,Electronics,SRV-001,20,5\nWire Kit,Hardware,WIR-001,100,20"></textarea>
            </div>
            <p class="text-sm text-muted">Categories must match existing categories. Use Manage Categories to add new ones first.</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-bulk-items">Import Items</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-bulk-items').addEventListener('click', async () => {
        const data = document.getElementById('bulk-items-data').value.trim();
        if (!data) {
            showToast('Please enter data to import.', 'error');
            return;
        }

        const lines = data.split('\n');
        let importCount = 0;

        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 3) {
                const name = parts[0].trim();
                const category = parts[1].trim();
                const sku = parts[2] ? parts[2].trim() : name.substring(0, 3).toUpperCase() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                const stock = parseInt(parts[3]) || 0;
                const threshold = parseInt(parts[4]) || 5;

                if (name) {
                    const item = {
                        id: generateId('ITM'),
                        name: name,
                        category: category,
                        sku: sku,
                        stock: stock,
                        threshold: threshold
                    };

                    const created = await addItemToSupabase(item);
                    if (created) importCount++;
                }
            }
        }

        await refreshInventoryFromSupabase();

        if (importCount > 0) {
            showToast(`Successfully imported ${importCount} items.`, 'success');
            addLog(currentUser.id, 'Bulk Import Items', `Imported ${importCount} inventory items.`);
        } else {
            showToast('No valid items found to import.', 'error');
        }

        closeModal();
        if (document.getElementById('page-inventory').classList.contains('active')) {
            renderInventory();
        }
    });
});

/* =======================================
   MANAGE CATEGORIES
   ======================================= */
document.getElementById('manage-categories-btn')?.addEventListener('click', () => {
    function renderCategoryModal() {
        const categoryList = categories.map((cat, i) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:var(--text-primary)">${cat}</span>
                <div style="display:flex;gap:0.5rem;">
                    <button class="icon-btn text-accent rename-cat-btn" data-index="${i}" title="Rename"><i class="ph ph-pencil-simple"></i></button>
                    <button class="icon-btn text-danger delete-cat-btn" data-index="${i}" title="Delete"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `).join('');

        const html = `
            <div class="modal-header">
                <h3><i class="ph ph-tag"></i> Manage Categories</h3>
                <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <div style="max-height:250px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:var(--radius-sm); border:1px solid var(--glass-border); margin-bottom:1rem;">
                    ${categoryList || '<p class="text-muted" style="padding:1rem;">No categories defined.</p>'}
                </div>
                <div class="form-group" style="display:flex;gap:0.5rem;">
                    <input type="text" id="new-category-name" class="form-control" placeholder="New category name" style="flex:1">
                    <button class="btn btn-primary" id="add-category-btn">Add</button>
                </div>
            </div>
        `;

        openModal(html);

        document.getElementById('add-category-btn')?.addEventListener('click', async () => {
            const name = document.getElementById('new-category-name').value.trim();
            if (name && !categories.includes(name)) {
                const created = await addCategoryToSupabase(name);
                if (!created) {
                    showToast('Failed to add category in Supabase.', 'error');
                    return;
                }
                await loadCategories();
                showToast(`Category "${name}" added.`, 'success');
                addLog(currentUser.id, 'Manage Categories', `Added category: ${name}`);
                renderCategoryModal();
            } else if (categories.includes(name)) {
                showToast('Category already exists.', 'error');
            }
        });

        document.querySelectorAll('.rename-cat-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const oldName = categories[idx];
                const newName = prompt(`Rename "${oldName}" to:`, oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    const renamed = await renameCategoryInSupabase(oldName, newName.trim());
                    if (!renamed) {
                        showToast('Failed to rename category in Supabase.', 'error');
                        return;
                    }
                    await Promise.all([
                        loadCategories(),
                        refreshInventoryFromSupabase()
                    ]);
                    showToast(`Category renamed to "${newName.trim()}".`, 'success');
                    addLog(currentUser.id, 'Manage Categories', `Renamed category: ${oldName} → ${newName.trim()}`);
                    renderCategoryModal();
                }
            });
        });

        document.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const catName = categories[idx];
                if (confirm(`Delete category "${catName}"? Items in this category will become "Uncategorized".`)) {
                    const moved = await renameCategoryInSupabase(catName, 'Uncategorized');
                    if (!moved) {
                        showToast('Failed to delete category in Supabase.', 'error');
                        return;
                    }
                    await Promise.all([
                        loadCategories(),
                        refreshInventoryFromSupabase()
                    ]);
                    showToast(`Category "${catName}" deleted.`, 'success');
                    addLog(currentUser.id, 'Manage Categories', `Deleted category: ${catName}`);
                    renderCategoryModal();
                }
            });
        });
    }

    renderCategoryModal();
});

/* =======================================
   MANAGE VISIBILITY TAGS
   ======================================= */
document.getElementById('manage-visibility-tags-btn')?.addEventListener('click', () => {
    function renderVisibilityTagModal() {
        const tagList = visibilityTags.map((tag, i) => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:0.5rem; border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="color:var(--text-primary)">${tag}</span>
                <div style="display:flex;gap:0.5rem;">
                    <button class="icon-btn text-accent rename-vtag-btn" data-index="${i}" title="Rename"><i class="ph ph-pencil-simple"></i></button>
                    <button class="icon-btn text-danger delete-vtag-btn" data-index="${i}" title="Delete"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `).join('');

        const html = `
            <div class="modal-header">
                <h3><i class="ph ph-eye"></i> Manage Visibility Tags</h3>
                <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <p class="text-secondary mb-4" style="font-size:0.85rem">Visibility tags are applied to items and allowed on classes. A student sees a tagged item only if their class allows that tag. Items with <em>no tags</em> are always visible to enrolled students.</p>
                <div style="max-height:250px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:var(--radius-sm); border:1px solid var(--glass-border); margin-bottom:1rem;">
                    ${tagList || '<p class="text-muted" style="padding:1rem;">No visibility tags defined.</p>'}
                </div>
                <div class="form-group" style="display:flex;gap:0.5rem;">
                    <input type="text" id="new-vtag-name" class="form-control" placeholder="New tag name (e.g. Advanced)" style="flex:1">
                    <button class="btn btn-primary" id="add-vtag-btn">Add</button>
                </div>
            </div>
        `;

        openModal(html);

        document.getElementById('add-vtag-btn')?.addEventListener('click', async () => {
            const name = document.getElementById('new-vtag-name').value.trim();
            if (name && !visibilityTags.includes(name)) {
                const created = await addVisibilityTagToSupabase(name);
                if (!created) {
                    showToast('Failed to add visibility tag in Supabase.', 'error');
                    return;
                }
                await loadVisibilityTags();
                showToast(`Visibility tag "${name}" added.`, 'success');
                addLog(currentUser.id, 'Manage Visibility Tags', `Added tag: ${name}`);
                renderVisibilityTagModal();
            } else if (visibilityTags.includes(name)) {
                showToast('That tag already exists.', 'error');
            }
        });

        document.querySelectorAll('.rename-vtag-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const oldName = visibilityTags[idx];
                const newName = prompt(`Rename "${oldName}" to:`, oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    const trimmed = newName.trim();
                    const renamed = await renameVisibilityTagInSupabase(oldName, trimmed);
                    if (!renamed) {
                        showToast('Failed to rename visibility tag in Supabase.', 'error');
                        return;
                    }
                    await Promise.all([
                        loadVisibilityTags(),
                        refreshInventoryFromSupabase(),
                        loadStudentClasses()
                    ]);
                    showToast(`Renamed "${oldName}" → "${trimmed}".`, 'success');
                    addLog(currentUser.id, 'Manage Visibility Tags', `Renamed tag: ${oldName} → ${trimmed}`);
                    renderVisibilityTagModal();
                }
            });
        });

        document.querySelectorAll('.delete-vtag-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const tagName = visibilityTags[idx];
                if (confirm(`Delete visibility tag "${tagName}"? It will be removed from all items and classes.`)) {
                    const deleted = await deleteVisibilityTagFromSupabase(tagName);
                    if (!deleted) {
                        showToast('Failed to delete visibility tag in Supabase.', 'error');
                        return;
                    }
                    await Promise.all([
                        loadVisibilityTags(),
                        refreshInventoryFromSupabase(),
                        loadStudentClasses()
                    ]);
                    showToast(`Tag "${tagName}" deleted.`, 'success');
                    addLog(currentUser.id, 'Manage Visibility Tags', `Deleted tag: ${tagName}`);
                    renderVisibilityTagModal();
                }
            });
        });
    }

    renderVisibilityTagModal();
});

/* =======================================
   ADD ITEM MODAL
   ======================================= */

/* =======================================
   SECRET DEBUG SYSTEM
   ======================================= */

// ── Config & runtime state ────────────────────────────────────────────
let debugConfig = {
    pin: null,               // null = unset; developer must configure first
    kioskLocked: false,
    kioskLockScreen: 'systemLocked',
    debugModeActive: false,
    adminFeaturesVisible: false,
    theme: 'dark',
    remoteUpdateUrl: ''
};

let usageStats = {
    totalLogins: 0,
    currentSessionStart: null,
    sessionLengths: [],
    itemSignouts: {},        // id → { name, count }
    pageVisits: {}           // pageId → count
};

const _debugLogs = [];       // circular buffer, max 300 entries

function _addDebugLog(type, msg) {
    if (_debugLogs.length >= 300) _debugLogs.shift();
    _debugLogs.push({ type, msg: String(msg), ts: new Date().toISOString() });
}

window.addEventListener('error', e =>
    _addDebugLog('error', `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', e =>
    _addDebugLog('error', `Unhandled rejection: ${e.reason}`));

// Patch console so we capture entries when debug mode is on
['log', 'warn', 'error'].forEach(lvl => {
    const orig = console[lvl].bind(console);
    console[lvl] = (...args) => {
        const msg = args.map(a =>
            typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a)
        ).join(' ');
        _addDebugLog(lvl, msg);
        orig(...args);
    };
});

// ── Stat trackers (called from login / logout / signout / nav) ────────
function _trackLogin() {
    usageStats.totalLogins++;
    usageStats.currentSessionStart = Date.now();
}
function _trackLogout() {
    if (usageStats.currentSessionStart) {
        usageStats.sessionLengths.push(Date.now() - usageStats.currentSessionStart);
        usageStats.currentSessionStart = null;
    }
}
function _trackItemSignout(item, qty) {
    if (!usageStats.itemSignouts[item.id])
        usageStats.itemSignouts[item.id] = { name: item.name, count: 0 };
    usageStats.itemSignouts[item.id].count += qty;
}
function _trackPageVisit(pageId) {
    usageStats.pageVisits[pageId] = (usageStats.pageVisits[pageId] || 0) + 1;
}

// ── PIN gate ─────────────────────────────────────────────────────────
function openDebugMenuGated() {
    if (!debugConfig.pin) {
        if (!currentUser || currentUser.role !== 'developer') {
            showToast('Debug menu not configured. Log in as developer to set the PIN.', 'error');
            return;
        }
        _promptSetDebugPin();
        return;
    }
    _promptEnterDebugPin();
}

function _promptSetDebugPin() {
    const html = `
        <div class="modal-header debug-modal-header">
            <h3 style="color:#a78bfa"><i class="ph ph-lock-key"></i> Set Debug PIN</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">No debug PIN is set. As a developer you can create one now.</p>
            <div class="form-group">
                <label>New PIN <small>(4–8 digits)</small></label>
                <input type="password" id="dbg-pin-new" class="form-control" maxlength="8" inputmode="numeric" placeholder="••••" autofocus>
            </div>
            <div class="form-group">
                <label>Confirm PIN</label>
                <input type="password" id="dbg-pin-confirm" class="form-control" maxlength="8" inputmode="numeric" placeholder="••••">
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="dbg-set-pin-btn">Set PIN</button>
        </div>`;
    openModal(html);
    document.getElementById('dbg-set-pin-btn')?.addEventListener('click', () => {
        const p1 = document.getElementById('dbg-pin-new').value.trim();
        const p2 = document.getElementById('dbg-pin-confirm').value.trim();
        if (!/^\d{4,8}$/.test(p1)) { showToast('PIN must be 4–8 digits.', 'error'); return; }
        if (p1 !== p2) { showToast('PINs do not match.', 'error'); return; }
        debugConfig.pin = p1;
        showToast('Debug PIN set.', 'success');
        closeModal();
        openDebugMenu();
    });
}

let _pinAttempts = 0;
function _promptEnterDebugPin() {
    _pinAttempts = 0;
    const html = `
        <div class="modal-header debug-modal-header">
            <h3 style="color:#a78bfa"><i class="ph ph-lock-key"></i> Debug Access</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Enter the debug PIN to continue.</p>
            <div class="form-group">
                <input type="password" id="dbg-pin-input" class="form-control" maxlength="8" inputmode="numeric" placeholder="PIN" autofocus>
                <small id="dbg-pin-err" class="text-danger" style="display:none;margin-top:0.25rem"></small>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="dbg-enter-pin-btn">Enter</button>
        </div>`;
    openModal(html);
    const tryPin = () => {
        const val = (document.getElementById('dbg-pin-input')?.value || '').trim();
        _pinAttempts++;
        if (val === debugConfig.pin) {
            _pinAttempts = 0;
            closeModal();
            openDebugMenu(debugConfig.kioskLocked ? 'session' : 'system');
        } else {
            const errEl = document.getElementById('dbg-pin-err');
            if (errEl) { errEl.style.display = ''; errEl.textContent = `Incorrect PIN. Attempt ${_pinAttempts}/5.`; }
            if (document.getElementById('dbg-pin-input')) document.getElementById('dbg-pin-input').value = '';
            if (_pinAttempts >= 5) { closeModal(); showToast('Too many incorrect PIN attempts.', 'error'); }
        }
    };
    document.getElementById('dbg-enter-pin-btn')?.addEventListener('click', tryPin);
    document.getElementById('dbg-pin-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') tryPin(); });
}

// ── Trigger mechanisms ────────────────────────────────────────────────
// 1. Hidden bottom-left tap zone — 4 taps within 2.5 s
let _dbgTapCount = 0, _dbgTapTimer = null;
(function _createDebugTapZone() {
    const zone = document.createElement('div');
    zone.id = 'debug-tap-zone';
    zone.style.cssText = 'position:fixed;bottom:0;left:0;width:64px;height:64px;z-index:10001;-webkit-tap-highlight-color:transparent;user-select:none;pointer-events:all;';
    zone.addEventListener('click', () => {
        _dbgTapCount++;
        if (_dbgTapTimer) clearTimeout(_dbgTapTimer);
        _dbgTapTimer = setTimeout(() => { _dbgTapCount = 0; }, 2500);
        if (_dbgTapCount >= 4) {
            _dbgTapCount = 0;
            clearTimeout(_dbgTapTimer);
            openDebugMenuGated();
        }
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => document.body.appendChild(zone));
    } else {
        document.body.appendChild(zone);
    }
}());

// 2. Keyboard shortcut: Ctrl + Shift + ` (backtick)
document.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    const openDebugRequested = e.ctrlKey && e.shiftKey && (key === '`' || key === 'd');
    if (openDebugRequested) {
        e.preventDefault();
        openDebugMenuGated();
    }
});

// 3. Version badge — 7 clicks within 3 s (version badge on login/sidebar)
let _dbgBadgeClicks = 0, _dbgBadgeTimer = null;
function _handleDebugBadgeClick() {
    _dbgBadgeClicks++;
    if (_dbgBadgeTimer) clearTimeout(_dbgBadgeTimer);
    _dbgBadgeTimer = setTimeout(() => { _dbgBadgeClicks = 0; }, 3000);
    if (_dbgBadgeClicks >= 7) {
        _dbgBadgeClicks = 0;
        clearTimeout(_dbgBadgeTimer);
        openDebugMenuGated();
    }
}
document.getElementById('app-version-login')?.addEventListener('click', _handleDebugBadgeClick);

// ── Kiosk lock ────────────────────────────────────────────────────────
const KIOSK_LOCK_SCREENS = {
    systemLocked: {
        label: 'System Locked',
        icon: 'lock',
        title: 'System Locked',
        description: 'Contact an administrator to unlock.'
    },
    outOfOrder: {
        label: 'Out of Order',
        icon: 'warning-octagon',
        title: 'Out of Order',
        description: 'This kiosk is currently out of service. Please use another station.'
    },
    kioskUnavailable: {
        label: 'Kiosk Unavailable',
        icon: 'desktop-tower',
        title: 'Kiosk Unavailable',
        description: 'This kiosk is temporarily unavailable. Please check back shortly.'
    }
};

const KIOSK_LOCK_SCREEN_ORDER = Object.keys(KIOSK_LOCK_SCREENS);
let kioskPreviewState = {
    isOpen: false,
    activeIndex: 0,
    touchStartX: null
};

function getKioskLockScreen(screenKey) {
    return KIOSK_LOCK_SCREENS[screenKey] || KIOSK_LOCK_SCREENS.systemLocked;
}

function getKioskLockMarkup(screenKey) {
    const screen = getKioskLockScreen(screenKey);
    return `<div class="kiosk-lock-card" style="text-align:center;">
        <i class="ph ph-${screen.icon} kiosk-lock-icon"></i>
        <h2 class="kiosk-lock-title">${screen.title}</h2>
        <p class="kiosk-lock-description">${screen.description}</p>
    </div>`;
}

function openKioskLockPreview(startScreenKey = debugConfig.kioskLockScreen || 'systemLocked') {
    kioskPreviewState.isOpen = true;
    kioskPreviewState.activeIndex = Math.max(0, KIOSK_LOCK_SCREEN_ORDER.indexOf(startScreenKey));
    kioskPreviewState.touchStartX = null;

    let preview = document.getElementById('kiosk-lock-preview');
    if (!preview) {
        preview = document.createElement('div');
        preview.id = 'kiosk-lock-preview';
        document.body.appendChild(preview);
    }

    preview.innerHTML = `
        <div class="kiosk-preview-topbar">
            <button class="btn btn-secondary" id="kiosk-preview-close"><i class="ph ph-x"></i> Cancel</button>
            <div class="kiosk-preview-title">Swipe to choose lock screen</div>
            <button class="btn btn-primary" id="kiosk-preview-lock"><i class="ph ph-lock"></i> Lock With This Screen</button>
        </div>
        <div class="kiosk-preview-stage" id="kiosk-preview-stage"></div>
        <div class="kiosk-preview-footer">
            <button class="btn btn-secondary" id="kiosk-preview-prev"><i class="ph ph-caret-left"></i> Previous</button>
            <div class="kiosk-preview-dots" id="kiosk-preview-dots"></div>
            <button class="btn btn-secondary" id="kiosk-preview-next">Next <i class="ph ph-caret-right"></i></button>
        </div>
    `;

    preview.classList.add('active');

    const updatePreview = () => {
        const key = KIOSK_LOCK_SCREEN_ORDER[kioskPreviewState.activeIndex] || 'systemLocked';
        debugConfig.kioskLockScreen = key;
        const stage = document.getElementById('kiosk-preview-stage');
        const dots = document.getElementById('kiosk-preview-dots');
        if (stage) stage.innerHTML = getKioskLockMarkup(key);
        if (dots) {
            dots.innerHTML = KIOSK_LOCK_SCREEN_ORDER.map((k, idx) =>
                `<button class="kiosk-preview-dot ${idx === kioskPreviewState.activeIndex ? 'active' : ''}" data-kiosk-dot="${idx}" title="${KIOSK_LOCK_SCREENS[k].label}"></button>`
            ).join('');
            dots.querySelectorAll('[data-kiosk-dot]').forEach(btn => {
                btn.addEventListener('click', () => {
                    kioskPreviewState.activeIndex = parseInt(btn.getAttribute('data-kiosk-dot'), 10) || 0;
                    updatePreview();
                });
            });
        }
    };

    const step = (delta) => {
        const len = KIOSK_LOCK_SCREEN_ORDER.length;
        kioskPreviewState.activeIndex = (kioskPreviewState.activeIndex + delta + len) % len;
        updatePreview();
    };

    document.getElementById('kiosk-preview-close')?.addEventListener('click', () => {
        closeKioskLockPreview();
        renderDebugTab('session');
    });
    document.getElementById('kiosk-preview-prev')?.addEventListener('click', () => step(-1));
    document.getElementById('kiosk-preview-next')?.addEventListener('click', () => step(1));
    document.getElementById('kiosk-preview-lock')?.addEventListener('click', () => {
        const chosen = KIOSK_LOCK_SCREEN_ORDER[kioskPreviewState.activeIndex] || 'systemLocked';
        debugConfig.kioskLockScreen = chosen;
        closeKioskLockPreview();
        applyKioskLock(true, chosen);
        showToast(`Kiosk locked: ${KIOSK_LOCK_SCREENS[chosen].label}.`, 'error');
        closeModal();
    });

    preview.addEventListener('touchstart', (e) => {
        kioskPreviewState.touchStartX = e.touches[0]?.clientX ?? null;
    }, { passive: true });
    preview.addEventListener('touchend', (e) => {
        if (kioskPreviewState.touchStartX === null) return;
        const endX = e.changedTouches[0]?.clientX ?? kioskPreviewState.touchStartX;
        const deltaX = endX - kioskPreviewState.touchStartX;
        kioskPreviewState.touchStartX = null;
        if (Math.abs(deltaX) < 40) return;
        if (deltaX < 0) step(1);
        else step(-1);
    }, { passive: true });

    updatePreview();
}

function closeKioskLockPreview() {
    kioskPreviewState.isOpen = false;
    kioskPreviewState.touchStartX = null;
    const preview = document.getElementById('kiosk-lock-preview');
    if (preview) {
        preview.classList.remove('active');
        preview.innerHTML = '';
    }
}

function applyKioskLock(lock, screenKey = debugConfig.kioskLockScreen || 'systemLocked') {
    debugConfig.kioskLocked = lock;
    debugConfig.kioskLockScreen = Object.keys(KIOSK_LOCK_SCREENS).includes(screenKey)
        ? screenKey
        : 'systemLocked';

    let overlay = document.getElementById('kiosk-lock-overlay');

    const renderOverlay = () => {
        overlay.innerHTML = `${getKioskLockMarkup(debugConfig.kioskLockScreen)}
        <p class="kiosk-lock-unlock-hint">Debug unlock: Ctrl+Shift+&#96;, Ctrl+Shift+D, or tap bottom-left 4x.</p>`;
        overlay.style.display = 'flex';
    };

    if (lock) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'kiosk-lock-overlay';
            document.body.appendChild(overlay);
        }

        if (currentUser) {
            returnToLoginView({ showMessage: false });
            setTimeout(renderOverlay, 360);
        } else {
            loginHelpView.classList.remove('active');
            loginHelpView.classList.add('hidden');
            loginView.classList.remove('hidden');
            loginView.classList.add('active');
            barcodeInput.focus();
            renderOverlay();
        }
    } else if (overlay) {
        overlay.style.display = 'none';
    }
}

// ── Theme system ──────────────────────────────────────────────────────
const THEMES = {
    dark:     { label: 'Dark (Default)',  bodyClass: 'dark-theme' },
    light:    { label: 'Light',           bodyClass: 'light-theme' },
    midnight: { label: 'Midnight Blue',   bodyClass: 'midnight-theme' },
    forest:   { label: 'Forest Green',    bodyClass: 'forest-theme' }
};

function applyTheme(key) {
    const theme = THEMES[key] || THEMES.dark;
    Object.values(THEMES).forEach(t => document.body.classList.remove(t.bodyClass));
    document.body.classList.add(theme.bodyClass);
    debugConfig.theme = key;
}

// ── Network test ──────────────────────────────────────────────────────
async function runNetworkPing(url = 'https://www.gstatic.com/generate_204') {
    const t0 = performance.now();
    try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store' });
        return { ok: true, ms: Math.round(performance.now() - t0) };
    } catch {
        return { ok: false, ms: null };
    }
}

// ── Main debug modal ──────────────────────────────────────────────────
function openDebugMenu(initialTab = 'system') {
    const html = `
        <div class="modal-header debug-modal-header">
            <div style="display:flex;align-items:center;gap:0.6rem">
                <i class="ph ph-bug" style="color:#a78bfa;font-size:1.3rem"></i>
                <h3 style="color:#a78bfa;margin:0">Debug Console</h3>
                ${debugConfig.debugModeActive ? '<span class="badge" style="background:rgba(239,68,68,0.2);color:var(--danger);font-size:0.65rem;padding:0.1rem 0.4rem">● LIVE</span>' : ''}
            </div>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="debug-tab-bar">
            <button class="debug-tab active" data-dtab="system"><i class="ph ph-cpu"></i> System</button>
            <button class="debug-tab" data-dtab="console"><i class="ph ph-terminal"></i> Console</button>
            <button class="debug-tab" data-dtab="session"><i class="ph ph-user-gear"></i> Session</button>
            <button class="debug-tab" data-dtab="stats"><i class="ph ph-chart-bar"></i> Stats</button>
            <button class="debug-tab" data-dtab="settings"><i class="ph ph-sliders"></i> Settings</button>
        </div>
        <div class="debug-modal-body" id="debug-tab-content"></div>
    `;
    openModal(html);
    dynamicModal.classList.add('debug-modal');
    document.querySelectorAll('.debug-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.debug-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderDebugTab(tab.dataset.dtab);
        });
    });
    renderDebugTab(initialTab);
}

function renderDebugTab(tab) {
    const el = document.getElementById('debug-tab-content');
    if (!el) return;
    switch (tab) {
        case 'system':   renderDebugSystem(el);   break;
        case 'console':  renderDebugConsole(el);  break;
        case 'session':  renderDebugSession(el);  break;
        case 'stats':    renderDebugStats(el);    break;
        case 'settings': renderDebugSettings(el); break;
    }
}

function _dbgSection(title, body) {
    return `<div class="debug-section"><div class="debug-section-title">${title}</div>${body}</div>`;
}

// ── System tab ────────────────────────────────────────────────────────
function renderDebugSystem(el) {
    const conn = navigator.connection;
    el.innerHTML = `
        ${_dbgSection('Device & Browser', `
            <table class="debug-table">
                <tr><td>Screen</td><td>${window.screen.width}×${window.screen.height} @${window.devicePixelRatio}x DPR</td></tr>
                <tr><td>Viewport</td><td>${window.innerWidth}×${window.innerHeight}</td></tr>
                <tr><td>Device Memory</td><td>${navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'N/A'}</td></tr>
                <tr><td>Connection</td><td>${conn ? conn.effectiveType + ' — ' + conn.downlink + ' Mbps' : 'N/A'}</td></tr>
                <tr><td>User Agent</td><td style="word-break:break-all;font-size:0.72rem">${navigator.userAgent}</td></tr>
                <tr><td>App Version</td><td>${appVersion}</td></tr>
                <tr><td>Local Time</td><td>${new Date().toLocaleString()}</td></tr>
            </table>
        `)}
        ${_dbgSection('App Actions', `
            <div class="debug-actions">
                <button class="dbg-btn btn btn-secondary" id="dbg-reload"><i class="ph ph-arrows-clockwise"></i> Reload App</button>
                <button class="dbg-btn btn btn-secondary" id="dbg-clear-ls"><i class="ph ph-trash"></i> Clear LocalStorage</button>
                <button class="dbg-btn btn btn-secondary" id="dbg-remote-update"><i class="ph ph-cloud-arrow-down"></i> Remote Update</button>
            </div>
        `)}
        ${_dbgSection('Network & Peripheral Tests', `
            <div class="debug-actions">
                <button class="dbg-btn btn btn-secondary" id="dbg-ping"><i class="ph ph-wifi-high"></i> Ping Network</button>
                <button class="dbg-btn btn btn-secondary" id="dbg-scanner-test"><i class="ph ph-barcode"></i> Test Barcode Scanner</button>
            </div>
            <div id="dbg-net-result" class="debug-result" style="display:none"></div>
        `)}
    `;
    document.getElementById('dbg-reload')?.addEventListener('click', () => {
        if (confirm('Reload the app? Unsaved in-memory data will be lost.')) location.reload();
    });
    document.getElementById('dbg-clear-ls')?.addEventListener('click', () => {
        if (confirm('Clear all localStorage keys?')) {
            try { localStorage.clear(); showToast('LocalStorage cleared.', 'success'); }
            catch { showToast('LocalStorage unavailable.', 'error'); }
        }
    });
    document.getElementById('dbg-remote-update')?.addEventListener('click', async () => {
        const btn = document.getElementById('dbg-remote-update');
        const url = debugConfig.remoteUpdateUrl || location.href;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner"></i> Checking…'; }
        const res = await runNetworkPing(url);
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-cloud-arrow-down"></i> Remote Update'; }
        const resEl = document.getElementById('dbg-net-result');
        if (resEl) {
            resEl.style.display = '';
            resEl.innerHTML = res.ok
                ? `<span style="color:var(--success)">✓ Server reachable (${res.ms}ms)</span>
                   <button class="btn btn-primary dbg-btn" style="margin-left:0.75rem" onclick="location.reload()">Reload Now</button>`
                : `<span style="color:var(--danger)">✗ Server unreachable — cannot update safely</span>`;
        }
    });
    document.getElementById('dbg-ping')?.addEventListener('click', async () => {
        const resEl = document.getElementById('dbg-net-result');
        if (resEl) { resEl.style.display = ''; resEl.textContent = 'Pinging…'; }
        const res = await runNetworkPing();
        if (resEl) resEl.innerHTML = res.ok
            ? `<span style="color:var(--success)">✓ Network reachable — ${res.ms} ms</span>`
            : `<span style="color:var(--danger)">✗ Network unreachable</span>`;
    });
    document.getElementById('dbg-scanner-test')?.addEventListener('click', () => {
        closeModal();
        showToast('Scan a barcode now. Result will appear as a toast.', 'info');
        const handler = (e) => {
            if (e.key === 'Enter') {
                const val = barcodeInput.value;
                barcodeInput.value = '';
                showToast(`Scanner received: "${val}" ✓`, 'success');
                barcodeInput.removeEventListener('keydown', handler, true);
            }
        };
        barcodeInput.focus();
        barcodeInput.addEventListener('keydown', handler, true);
    });
}

// ── Console tab ───────────────────────────────────────────────────────
function renderDebugConsole(el) {
    const entries = _debugLogs.slice().reverse();
    const logHtml = entries.length > 0 ? entries.map(l => {
        const col = l.type === 'error' ? 'var(--danger)' : l.type === 'warn' ? '#f59e0b' : 'var(--text-secondary)';
        const bg  = l.type === 'error' ? 'rgba(239,68,68,0.15)' : l.type === 'warn' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)';
        return `<div style="border-bottom:1px solid rgba(255,255,255,0.04);padding:0.3rem 0.25rem;font-size:0.73rem;color:${col};font-family:monospace">
            <span style="opacity:0.5;margin-right:0.4rem">${l.ts.slice(11,19)}</span>
            <span style="background:${bg};padding:0 0.3rem;border-radius:3px;font-size:0.65rem;margin-right:0.35rem">${l.type}</span>
            <span style="word-break:break-all">${l.msg}</span>
        </div>`;
    }).join('') : '<p class="text-muted text-sm" style="padding:0.5rem">No entries captured yet.</p>';

    el.innerHTML = `
        ${_dbgSection(`Console Log (${_debugLogs.length} entries)`, `
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.75rem;flex-wrap:wrap">
                <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.85rem">
                    <input type="checkbox" id="dbg-live-cb" ${debugConfig.debugModeActive ? 'checked' : ''}> Capture enabled
                </label>
                <div style="margin-left:auto;display:flex;gap:0.5rem">
                    <button class="dbg-btn btn btn-secondary" id="dbg-refresh-log"><i class="ph ph-arrows-clockwise"></i></button>
                    <button class="dbg-btn btn btn-secondary" id="dbg-clear-log"><i class="ph ph-trash"></i> Clear</button>
                </div>
            </div>
            <div style="max-height:340px;overflow-y:auto;background:rgba(0,0,0,0.35);border-radius:var(--radius-sm);border:1px solid var(--glass-border);padding:0.25rem">
                ${logHtml}
            </div>
        `)}
    `;
    document.getElementById('dbg-live-cb')?.addEventListener('change', e => { debugConfig.debugModeActive = e.target.checked; });
    document.getElementById('dbg-clear-log')?.addEventListener('click', () => { _debugLogs.length = 0; renderDebugTab('console'); });
    document.getElementById('dbg-refresh-log')?.addEventListener('click', () => renderDebugTab('console'));
}

// ── Session tab ───────────────────────────────────────────────────────
function renderDebugSession(el) {
    const user = currentUser;
    const classes = user?.role === 'student' ? getStudentClassesForUser(user.id) : [];
    const mp = user?.role === 'student' ? getMergedPermissionsForStudent(user) : null;
    const rl = loginRateLimit;
    const rlLocked = rl.lockedUntil && Date.now() < rl.lockedUntil;
    const lockScreenLabel = KIOSK_LOCK_SCREENS[debugConfig.kioskLockScreen]?.label || KIOSK_LOCK_SCREENS.systemLocked.label;
    const rlStatus = rlLocked
        ? `<span style="color:var(--danger)">LOCKED — ${Math.ceil((rl.lockedUntil - Date.now()) / 1000)}s remaining</span>`
        : `<span style="color:var(--success)">OK (${rl.attempts.filter(t => Date.now() - t < rl.windowMs).length}/${rl.maxAttempts} in window)</span>`;

    el.innerHTML = `
        ${_dbgSection('Current Session', `
            <table class="debug-table">
                <tr><td>User</td><td>${user ? `${user.name} (${user.id})` : '<em>Not logged in</em>'}</td></tr>
                <tr><td>Role</td><td>${user?.role || '—'}</td></tr>
                ${mp ? `<tr><td>Classes</td><td>${classes.map(c => c.name).join(', ') || 'None'}</td></tr>
                <tr><td>Merged Perms</td><td>Create ${mp.canCreateProjects ? '✓' : '✗'} · Join ${mp.canJoinProjects ? '✓' : '✗'} · SignOut ${mp.canSignOut ? '✓' : '✗'}</td></tr>` : ''}
                <tr><td>Rate Limit</td><td>${rlStatus}</td></tr>
                <tr><td>Kiosk</td><td>${debugConfig.kioskLocked ? '<span style="color:var(--danger)">LOCKED</span>' : '<span style="color:var(--success)">Unlocked</span>'}</td></tr>
                <tr><td>Lock Screen</td><td>${lockScreenLabel}</td></tr>
            </table>
        `)}
        ${_dbgSection('Controls', `
            <div class="debug-actions">
                ${user ? `<button class="dbg-btn btn btn-secondary" id="dbg-force-logout"><i class="ph ph-sign-out"></i> Force Logout</button>` : ''}
                <button class="dbg-btn btn btn-secondary" id="dbg-clear-rl"><i class="ph ph-shield-slash"></i> Reset Rate Limit</button>
                <button class="dbg-btn btn btn-secondary" id="dbg-kiosk-preview">
                    <i class="ph ph-device-mobile-camera"></i> Preview Lock Screens
                </button>
                <button class="dbg-btn btn ${debugConfig.kioskLocked ? 'btn-primary' : 'btn-danger'}" id="dbg-kiosk">
                    <i class="ph ph-${debugConfig.kioskLocked ? 'lock-open' : 'lock'}"></i>
                    ${debugConfig.kioskLocked ? 'Unlock Kiosk' : 'Lock Kiosk'}
                </button>
                <button class="dbg-btn btn btn-secondary" id="dbg-toggle-admin">
                    <i class="ph ph-${debugConfig.adminFeaturesVisible ? 'eye-slash' : 'eye'}"></i>
                    ${debugConfig.adminFeaturesVisible ? 'Hide' : 'Show'} Admin Features
                </button>
            </div>
        `)}
        ${_dbgSection('Recent Audit Trail', `
            <div style="max-height:220px;overflow-y:auto">
                ${activityLogs.slice(0, 15).map(log => {
                    const u = mockUsers.find(u => u.id === log.userId);
                    return `<div style="font-size:0.76rem;padding:0.25rem 0;border-bottom:1px solid rgba(255,255,255,0.04)">
                        <span class="text-muted">${new Date(log.timestamp).toLocaleString()}</span>
                        <span style="margin:0 0.3rem">—</span>
                        <strong>${u?.name || log.userId}</strong>: ${log.action}
                        <span class="text-muted"> — ${log.details}</span>
                    </div>`;
                }).join('') || '<p class="text-muted text-sm">No logs.</p>'}
            </div>
        `)}
    `;
    document.getElementById('dbg-force-logout')?.addEventListener('click', () => { closeModal(); logout('Debug: session reset'); });
    document.getElementById('dbg-clear-rl')?.addEventListener('click', () => {
        loginRateLimit.attempts = []; loginRateLimit.lockedUntil = null;
        showToast('Rate limit cleared.', 'success'); renderDebugTab('session');
    });
    document.getElementById('dbg-kiosk-preview')?.addEventListener('click', () => {
        openKioskLockPreview(debugConfig.kioskLockScreen);
    });
    document.getElementById('dbg-kiosk')?.addEventListener('click', () => {
        const locking = !debugConfig.kioskLocked;
        const chosen = debugConfig.kioskLockScreen || 'systemLocked';
        applyKioskLock(locking, chosen);
        const screenName = getKioskLockScreen(chosen).label;
        showToast(locking ? `Kiosk locked: ${screenName}.` : 'Kiosk unlocked.', locking ? 'error' : 'success');
        if (locking) { closeModal(); } else { renderDebugTab('session'); }
    });
    document.getElementById('dbg-toggle-admin')?.addEventListener('click', () => {
        debugConfig.adminFeaturesVisible = !debugConfig.adminFeaturesVisible;
        showToast(`Admin features ${debugConfig.adminFeaturesVisible ? 'visible' : 'hidden'}.`);
        renderDebugTab('session');
    });
}

// ── Stats tab ─────────────────────────────────────────────────────────
function renderDebugStats(el) {
    const s = usageStats;
    const avg = s.sessionLengths.length
        ? Math.round(s.sessionLengths.reduce((a, b) => a + b, 0) / s.sessionLengths.length / 1000)
        : 0;
    const curLen = s.currentSessionStart ? Math.round((Date.now() - s.currentSessionStart) / 1000) : 0;
    const topItems = Object.values(s.itemSignouts).sort((a, b) => b.count - a.count).slice(0, 10);
    const topPages = Object.entries(s.pageVisits).sort((a, b) => b[1] - a[1]);

    el.innerHTML = `
        ${_dbgSection('Session & Login Stats', `
            <table class="debug-table">
                <tr><td>Total Logins (this load)</td><td>${s.totalLogins}</td></tr>
                <tr><td>Current Session</td><td>${curLen}s</td></tr>
                <tr><td>Avg Session Length</td><td>${avg}s (${s.sessionLengths.length} recorded)</td></tr>
            </table>
        `)}
        ${_dbgSection('Most Signed-out Items', topItems.length ? `
            <table class="debug-table">
                <thead><tr><th>Item</th><th>Total Qty</th></tr></thead>
                <tbody>${topItems.map(i => `<tr><td>${i.name}</td><td>${i.count}</td></tr>`).join('')}</tbody>
            </table>
        ` : '<p class="text-muted text-sm">No sign-outs recorded yet.</p>')}
        ${_dbgSection('Page Navigation Frequency', topPages.length ? `
            <table class="debug-table">
                <thead><tr><th>Page</th><th>Visits</th></tr></thead>
                <tbody>${topPages.map(([p, v]) => `<tr><td>${p}</td><td>${v}</td></tr>`).join('')}</tbody>
            </table>
        ` : '<p class="text-muted text-sm">No navigation recorded yet.</p>')}
        ${_dbgSection('Inventory Snapshot', `
            <table class="debug-table">
                <tr><td>Total Items</td><td>${inventoryItems.length}</td></tr>
                <tr><td>Users</td><td>${mockUsers.length}</td></tr>
                <tr><td>Classes</td><td>${studentClasses.length}</td></tr>
                <tr><td>Activity Logs</td><td>${activityLogs.length}</td></tr>
                <tr><td>Visibility Tags</td><td>${visibilityTags.join(', ') || 'none'}</td></tr>
            </table>
        `)}
    `;
}

// ── Settings tab ──────────────────────────────────────────────────────
function renderDebugSettings(el) {
    const themeRadios = Object.entries(THEMES).map(([k, t]) =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.35rem 0.5rem;border-radius:var(--radius-sm);${debugConfig.theme === k ? 'background:rgba(139,92,246,0.15)' : ''}">
            <input type="radio" name="dbg-theme-radio" value="${k}" ${debugConfig.theme === k ? 'checked' : ''}> ${t.label}
        </label>`
    ).join('');

    el.innerHTML = `
        ${_dbgSection('Theme', `<div style="display:flex;flex-direction:column;gap:0.1rem">${themeRadios}</div>`)}
        ${_dbgSection('Debug PIN', `
            <div class="debug-actions">
                <button class="dbg-btn btn btn-secondary" id="dbg-change-pin"><i class="ph ph-lock-key"></i> Change PIN</button>
            </div>
            <small class="text-muted" style="display:block;margin-top:0.4rem">Only developer accounts can change the PIN.</small>
        `)}
        ${_dbgSection('Access Methods', `
            <table class="debug-table">
                <tr><td>Touch Gesture</td><td>Tap <strong>bottom-left corner</strong> 4× within 2.5 s</td></tr>
                <tr><td>Keyboard Shortcut</td><td><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>\`</kbd></td></tr>
                <tr><td>Badge Clicks</td><td>Click <strong>version badge</strong> 7× within 3 s</td></tr>
            </table>
        `)}
        ${_dbgSection('Feature Flags', `
            <div style="display:flex;flex-direction:column;gap:0.5rem">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                    <input type="checkbox" id="dbg-live-mode" ${debugConfig.debugModeActive ? 'checked' : ''}> Console log capture active
                </label>
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                    <input type="checkbox" id="dbg-admin-flag" ${debugConfig.adminFeaturesVisible ? 'checked' : ''}> Admin-only features visible
                </label>
            </div>
        `)}
    `;
    document.querySelectorAll('input[name="dbg-theme-radio"]').forEach(r => {
        r.addEventListener('change', () => { applyTheme(r.value); renderDebugTab('settings'); });
    });
    document.getElementById('dbg-change-pin')?.addEventListener('click', () => {
        if (!currentUser || currentUser.role !== 'developer') {
            showToast('Only developers can change the debug PIN.', 'error'); return;
        }
        debugConfig.pin = null;
        closeModal();
        _promptSetDebugPin();
    });
    document.getElementById('dbg-live-mode')?.addEventListener('change', e => {
        debugConfig.debugModeActive = e.target.checked;
        showToast(`Console capture ${e.target.checked ? 'enabled' : 'disabled'}.`);
    });
    document.getElementById('dbg-admin-flag')?.addEventListener('change', e => {
        debugConfig.adminFeaturesVisible = e.target.checked;
    });
}

