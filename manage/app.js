// LCHS Inventory System - Application Logic

/* =======================================
   STATE & INITIALIZATION
   ======================================= */
let currentUser = null;
let privilegedSessionAuthenticated = false;
const privilegedPasswordStoragePrefix = 'privilegedAuthPasswordHash:';
let privilegedStartupAuditShown = false;

const envConfig = window.APP_ENV || {};
const appMode = String(envConfig.APP_MODE || '').trim().toLowerCase();
const isManageMode = appMode === 'manage';
const kioskId = String(envConfig.KIOSK_ID ?? envConfig.kioskId ?? '').trim();
const configuredOrganizationId = String(
    envConfig.ORGANIZATION_ID
    ?? envConfig.APP_ORGANIZATION_ID
    ?? envConfig.organizationId
    ?? ''
).trim();
let appVersion = String(envConfig.APP_VERSION ?? envConfig.APP_Version ?? 'VERSION').trim() || 'VERSION';
const appName = String(envConfig.APP_NAME ?? 'LCHS').trim() || 'LCHS';
const appSubtitle = String(envConfig.APP_SUBTITLE ?? 'Secure Inventory Management').trim() || 'Secure Inventory Management';
const appLogoUrl = String(envConfig.APP_LOGO_URL ?? envConfig.APP_IMAGE_URL ?? '').trim();
const appSidebarLogoUrl = String(envConfig.APP_SIDEBAR_LOGO_URL ?? appLogoUrl).trim();
window.RUNTIME_APP_VERSION = appVersion;
let runtimeOrganizationId = configuredOrganizationId;

let kioskVersionChannel = null;
let appLicenseBlocked = false;
let appLicenseState = {
    checked: false,
    configured: false,
    valid: false,
    expectedHash: '',
    providedHash: '',
    message: 'License has not been checked yet.'
};

const defaultDuePolicy = {
    defaultSignoutMinutes: 80,
    timezone: 'America/Edmonton',
    periodRanges: [
        { start: '08:00', end: '08:55', dueAtTime: '08:55' }
    ]
};

let signoutPolicy = {
    defaultSignoutMinutes: defaultDuePolicy.defaultSignoutMinutes,
    timezone: defaultDuePolicy.timezone,
    periodRanges: defaultDuePolicy.periodRanges.map(range => ({ ...range }))
};

const POLICY_CONFIG_STORAGE_KEY = 'managePolicyConfigV1';
const KIOSK_CONFIG_STORAGE_KEY = 'manageKioskConfigV1';
const CONFIG_SNAPSHOT_STORAGE_KEY = 'manageConfigSnapshotsV1';

const defaultPolicyConfig = {
    duePolicy: {
        defaultSignoutMinutes: defaultDuePolicy.defaultSignoutMinutes,
        timezone: defaultDuePolicy.timezone,
        periodRanges: defaultDuePolicy.periodRanges.map(range => ({ ...range }))
    },
    checkoutConstraints: {
        maxItemsPerCheckout: 20,
        maxDistinctItemsPerCheckout: 10,
        allowStudentAssignOthers: false
    },
    accessLevelDefaults: {
        canCreateProjects: false,
        canJoinProjects: true,
        canSignOut: true
    },
    healthThresholds: {
        loginFailureThreshold: 5,
        unlockFailureThreshold: 3,
        staleKioskMinutes: 45
    }
};

const defaultKioskManageConfig = {
    location: '',
    brandingText: '',
    featureFlags: {
        allowUnlockPulse: true,
        allowEmergencyLockout: true,
        enableAuditCsvExport: true,
        enforcePrivilegedAuditFocus: true
    }
};

let policyConfig = {
    duePolicy: {
        defaultSignoutMinutes: defaultPolicyConfig.duePolicy.defaultSignoutMinutes,
        timezone: defaultPolicyConfig.duePolicy.timezone,
        periodRanges: defaultPolicyConfig.duePolicy.periodRanges.map(range => ({ ...range }))
    },
    checkoutConstraints: { ...defaultPolicyConfig.checkoutConstraints },
    accessLevelDefaults: { ...defaultPolicyConfig.accessLevelDefaults },
    healthThresholds: { ...defaultPolicyConfig.healthThresholds }
};

let kioskManageConfig = {
    location: defaultKioskManageConfig.location,
    brandingText: defaultKioskManageConfig.brandingText,
    featureFlags: { ...defaultKioskManageConfig.featureFlags }
};

const kioskLiveStatus = {
    realtimeConnected: false,
    lastSyncAt: null,
    lastSettingsVersion: '',
    lastKnownLockState: false,
    lastKnownLockScreen: 'systemLocked'
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
const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const loginSubmitBtn = document.getElementById('login-submit-btn');
const showHelpBtn = document.getElementById('show-help-btn');
const backToLoginBtn = document.getElementById('back-to-login-btn');
const submitHelpBtn = document.getElementById('submit-help-btn');

// DOM Elements - Sidebar & Profile
const userNameEl = document.getElementById('user-name');
const userRoleEl = document.getElementById('user-role');
const userProfileEl = document.querySelector('.user-profile');
const userAvatarEl = document.getElementById('user-avatar');
const navBtns = document.querySelectorAll('.nav-btn[data-target]');
const logoutBtn = document.getElementById('logout-btn');
const pageTitle = document.getElementById('page-title');
const navLogs = document.getElementById('nav-logs');
const navUsers = document.getElementById('nav-users');
const navClasses = document.getElementById('nav-classes');
const navOrders = document.getElementById('nav-orders');

// DOM Elements - Pages
const pages = document.querySelectorAll('.page');

const ordersStudentViewStorageKey = 'ordersStudentViewEnabled';
const defaultOrdersStudentView = String(envConfig.ALLOW_STUDENT_ORDER_VIEW || 'false').toLowerCase() === 'true';
let ordersStudentViewEnabled = localStorage.getItem(ordersStudentViewStorageKey) === null
    ? defaultOrdersStudentView
    : localStorage.getItem(ordersStudentViewStorageKey) === 'true';

let inventorySmartSearchTerm = '';
let inventorySearchDebounceTimer = null;
let ordersTabMode = 'all';

// Modals & Toasts
const modalContainer = document.getElementById('modal-container');
const dynamicModal = document.getElementById('dynamic-modal');
const toastContainer = document.getElementById('toast-container');
let lastModalClipboardInteractionAt = 0;

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
    buttonEl.textContent = '';
    const spinnerEl = document.createElement('i');
    spinnerEl.className = 'ph ph-spinner ph-spin';
    const labelNode = document.createTextNode(` ${String(pendingLabel || 'Working...')}`);
    buttonEl.appendChild(spinnerEl);
    buttonEl.appendChild(labelNode);

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

function canAttemptLogin() {
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

function checkLoginRateLimit() {
    return canAttemptLogin();
}

let loginRequestInFlight = false;

async function completeAuthenticatedSession(user) {
    if (!user) return false;

    if (user.status === 'Suspended' && !isSuspensionBypassedUser(user)) {
        showToast('Your account is suspended. Please contact a teacher.', 'error');
        return false;
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
        return false;
    }

    loadAllData().catch(loadError => {
        console.error('Post-login load failed:', loadError);
        showToast('Signed in, but data refresh failed.', 'warning');
    });

    return true;
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
        .map(range => {
            const start = range?.start || '';
            const end = range?.end || '';
            const startMinutes = parseTimeToMinutes(start);
            const endMinutes = parseTimeToMinutes(end);

            let resolvedDueAt = String(range?.dueAtTime || '').slice(0, 5);
            const dueAtFromLegacyMode = String(range?.dueMode || '').trim();

            // Backward compatibility: convert old mode-based rows to an explicit due-at time.
            if (!resolvedDueAt && startMinutes !== null && endMinutes !== null) {
                if (dueAtFromLegacyMode === 'minutes_before_end') {
                    const minutesBefore = Math.max(0, parseInt(range?.dueMinutesBeforeEnd, 10) || 0);
                    const target = Math.max(startMinutes, endMinutes - minutesBefore);
                    const hh = String(Math.floor(target / 60)).padStart(2, '0');
                    const mm = String(target % 60).padStart(2, '0');
                    resolvedDueAt = `${hh}:${mm}`;
                } else {
                    resolvedDueAt = end;
                }
            }

            return {
                start,
                end,
                dueAtTime: resolvedDueAt || end
            };
        })
        .filter(range => parseTimeToMinutes(range.start) !== null && parseTimeToMinutes(range.end) !== null);

    return {
        defaultSignoutMinutes: Math.max(1, parseInt(policy?.defaultSignoutMinutes, 10) || defaultDuePolicy.defaultSignoutMinutes),
        timezone: policy?.timezone || defaultDuePolicy.timezone,
        periodRanges: normalizedRanges.length > 0 ? normalizedRanges : fallbackRanges
    };
}

function loadPolicyConfig() {
    try {
        const raw = localStorage.getItem(POLICY_CONFIG_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        policyConfig = {
            duePolicy: normalizeDuePolicy(parsed?.duePolicy || defaultPolicyConfig.duePolicy),
            checkoutConstraints: {
                ...defaultPolicyConfig.checkoutConstraints,
                ...(parsed?.checkoutConstraints || {})
            },
            accessLevelDefaults: {
                ...defaultPolicyConfig.accessLevelDefaults,
                ...(parsed?.accessLevelDefaults || {})
            },
            healthThresholds: {
                ...defaultPolicyConfig.healthThresholds,
                ...(parsed?.healthThresholds || {})
            }
        };
        signoutPolicy = normalizeDuePolicy(policyConfig.duePolicy);
    } catch {
        policyConfig = {
            duePolicy: normalizeDuePolicy(defaultPolicyConfig.duePolicy),
            checkoutConstraints: { ...defaultPolicyConfig.checkoutConstraints },
            accessLevelDefaults: { ...defaultPolicyConfig.accessLevelDefaults },
            healthThresholds: { ...defaultPolicyConfig.healthThresholds }
        };
    }
}

function savePolicyConfig(nextConfig) {
    policyConfig = {
        duePolicy: normalizeDuePolicy(nextConfig?.duePolicy || policyConfig.duePolicy),
        checkoutConstraints: {
            ...defaultPolicyConfig.checkoutConstraints,
            ...(nextConfig?.checkoutConstraints || {})
        },
        accessLevelDefaults: {
            ...defaultPolicyConfig.accessLevelDefaults,
            ...(nextConfig?.accessLevelDefaults || {})
        },
        healthThresholds: {
            ...defaultPolicyConfig.healthThresholds,
            ...(nextConfig?.healthThresholds || {})
        }
    };

    signoutPolicy = normalizeDuePolicy(policyConfig.duePolicy);
    localStorage.setItem(POLICY_CONFIG_STORAGE_KEY, JSON.stringify(policyConfig));
}

function loadKioskManageConfig() {
    try {
        const raw = localStorage.getItem(KIOSK_CONFIG_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        kioskManageConfig = {
            location: String(parsed?.location || '').trim(),
            brandingText: String(parsed?.brandingText || '').trim(),
            featureFlags: {
                ...defaultKioskManageConfig.featureFlags,
                ...(parsed?.featureFlags || {})
            }
        };
    } catch {
        kioskManageConfig = {
            location: defaultKioskManageConfig.location,
            brandingText: defaultKioskManageConfig.brandingText,
            featureFlags: { ...defaultKioskManageConfig.featureFlags }
        };
    }
}

function saveKioskManageConfig(nextConfig) {
    kioskManageConfig = {
        location: String(nextConfig?.location || '').trim(),
        brandingText: String(nextConfig?.brandingText || '').trim(),
        featureFlags: {
            ...defaultKioskManageConfig.featureFlags,
            ...(nextConfig?.featureFlags || {})
        }
    };
    localStorage.setItem(KIOSK_CONFIG_STORAGE_KEY, JSON.stringify(kioskManageConfig));
}

function getStoredConfigSnapshots() {
    try {
        const raw = localStorage.getItem(CONFIG_SNAPSHOT_STORAGE_KEY);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveConfigSnapshots(snapshots) {
    const nextSnapshots = Array.isArray(snapshots) ? snapshots.slice(0, 30) : [];
    localStorage.setItem(CONFIG_SNAPSHOT_STORAGE_KEY, JSON.stringify(nextSnapshots));
}

function createConfigSnapshot(label = '') {
    const snapshot = {
        id: generateId('SNAP'),
        label: String(label || '').trim() || `Snapshot ${new Date().toLocaleString()}`,
        createdAt: new Date().toISOString(),
        policyConfig,
        kioskManageConfig,
        orderFormConfig
    };
    const snapshots = getStoredConfigSnapshots();
    snapshots.unshift(snapshot);
    saveConfigSnapshots(snapshots);
    return snapshot;
}

function restoreConfigSnapshot(snapshotId) {
    const snapshots = getStoredConfigSnapshots();
    const target = snapshots.find(snapshot => String(snapshot.id) === String(snapshotId));
    if (!target) return false;

    savePolicyConfig(target.policyConfig || defaultPolicyConfig);
    saveKioskManageConfig(target.kioskManageConfig || defaultKioskManageConfig);
    if (target.orderFormConfig) {
        saveOrderFormConfig(target.orderFormConfig);
    }
    applyKioskManageBranding();
    return true;
}

function applyKioskManageBranding() {
    const subtitleEl = document.getElementById('app-login-subtitle');
    if (subtitleEl) {
        subtitleEl.textContent = kioskManageConfig.brandingText || appSubtitle;
    }
}

function exceedsCheckoutConstraints({ distinctItems = 0, totalQuantity = 0 }) {
    const maxDistinct = Math.max(1, parseInt(policyConfig.checkoutConstraints.maxDistinctItemsPerCheckout, 10) || defaultPolicyConfig.checkoutConstraints.maxDistinctItemsPerCheckout);
    const maxQty = Math.max(1, parseInt(policyConfig.checkoutConstraints.maxItemsPerCheckout, 10) || defaultPolicyConfig.checkoutConstraints.maxItemsPerCheckout);

    if (distinctItems > maxDistinct) {
        return `Checkout exceeds max distinct items (${maxDistinct}).`;
    }
    if (totalQuantity > maxQty) {
        return `Checkout exceeds max total quantity (${maxQty}).`;
    }
    return '';
}

function downloadCsv(filename, headers, rows) {
    const encodeCell = (value) => {
        const cell = String(value ?? '');
        if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
            return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
    };

    const csvText = [
        headers.map(encodeCell).join(','),
        ...rows.map(row => row.map(encodeCell).join(','))
    ].join('\n');

    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function getClassPermissionScore(cls) {
    const perms = cls?.defaultPermissions || {};
    let score = 0;
    if (perms.canSignOut) score += 4;
    if (perms.canCreateProjects) score += 2;
    if (perms.canJoinProjects) score += 1;
    return score;
}

function getEffectiveClassForDuePolicy(user, project = null) {
    if (user?.role !== 'student') return null;

    const userClasses = getStudentClassesForUser(user.id);
    if (userClasses.length === 0) return null;

    const projectClassId = String(project?.class_id || project?.classId || '').trim();
    if (projectClassId) {
        const matchedProjectClass = userClasses.find(cls => String(cls.id) === projectClassId);
        if (matchedProjectClass) return matchedProjectClass;
    }

    const sortedByPermission = [...userClasses].sort((a, b) => {
        const scoreDiff = getClassPermissionScore(b) - getClassPermissionScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return String(a.id).localeCompare(String(b.id));
    });

    return sortedByPermission[0] || null;
}

function getEffectiveDuePolicyForUser(user, project = null) {
    const effectiveClass = getEffectiveClassForDuePolicy(user, project);
    if (effectiveClass?.duePolicy) {
        return normalizeDuePolicy(effectiveClass.duePolicy);
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

function resolveDueDateFromMode(signoutDate, duePolicy, matchingRange, mode, minutesBeforeEnd, dueAtTime) {
    const dueDate = new Date(signoutDate);
    const currentMinutes = getLocalTimeMinutes(signoutDate, duePolicy.timezone || defaultDuePolicy.timezone);

    if ((mode === 'at_period_end' || mode === 'minutes_before_end') && matchingRange) {
        const endMinutes = parseTimeToMinutes(matchingRange.end);
        if (endMinutes !== null) {
            const minutesBefore = mode === 'minutes_before_end'
                ? Math.max(0, parseInt(minutesBeforeEnd, 10) || 0)
                : 0;
            const targetMinutes = Math.max(0, endMinutes - minutesBefore);
            const delta = Math.max(0, targetMinutes - currentMinutes);
            dueDate.setMinutes(dueDate.getMinutes() + delta);
            return dueDate;
        }
    }

    if (mode === 'due_at_time') {
        const dueMinutes = parseTimeToMinutes(dueAtTime);
        if (dueMinutes !== null) {
            const delta = Math.max(0, dueMinutes - currentMinutes);
            dueDate.setMinutes(dueDate.getMinutes() + delta);
            return dueDate;
        }
    }

    return null;
}

function calculateDueDate(signoutDate = new Date(), user = currentUser, project = null) {
    const duePolicy = getEffectiveDuePolicyForUser(user, project);
    let dueDate = new Date(signoutDate);

    const matchingRange = getMatchingPolicyRange(signoutDate, duePolicy);
    if (matchingRange) {
        const classDueDate = resolveDueDateFromMode(
            signoutDate,
            duePolicy,
            matchingRange,
            'due_at_time',
            0,
            matchingRange.dueAtTime
        );

        if (classDueDate) {
            dueDate = classDueDate;
        } else {
            const fallbackToPeriodEnd = resolveDueDateFromMode(
                signoutDate,
                duePolicy,
                matchingRange,
                'at_period_end',
                0,
                ''
            );
            dueDate = fallbackToPeriodEnd || dueDate;
        }
    } else {
        dueDate.setMinutes(dueDate.getMinutes() + duePolicy.defaultSignoutMinutes);
    }

    const projectDueBehavior = String(project?.due_behavior || project?.dueBehavior || 'class_default');
    if (projectDueBehavior !== 'class_default') {
        const projectOverrideDueDate = resolveDueDateFromMode(
            signoutDate,
            duePolicy,
            matchingRange,
            projectDueBehavior,
            project?.due_minutes_before_end ?? project?.dueMinutesBeforeEnd,
            project?.due_fixed_time ?? project?.dueFixedTime
        );

        if (projectDueBehavior === 'due_immediately') {
            dueDate = new Date(signoutDate);
        } else if (projectOverrideDueDate) {
            dueDate = projectOverrideDueDate;
        }
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

function buildPeriodRowHtml(start = '', end = '', dueAtTime = '') {
    return `
        <div class="period-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 36px;gap:0.5rem;align-items:center;margin-bottom:0.5rem">
            <input type="time" class="form-control period-start" value="${start}" title="Period start time">
            <input type="time" class="form-control period-end" value="${end}" title="Period end time">
            <input type="time" class="form-control period-due-at" value="${dueAtTime || end || ''}" title="Due back time for this period">
            <button type="button" class="btn btn-secondary remove-period-row-btn" style="padding:0.25rem 0.5rem" title="Remove period"><i class="ph ph-trash"></i></button>
        </div>`;
}

function buildPeriodRowsHtml(periodRanges) {
    return periodRanges.map(r => buildPeriodRowHtml(r.start, r.end, r.dueAtTime)).join('');
}

function collectPeriodRowsFromModal(containerId) {
    const rows = document.querySelectorAll(`#${containerId} .period-row`);
    const ranges = [];
    rows.forEach(row => {
        const start = row.querySelector('.period-start').value;
        const end = row.querySelector('.period-end').value;
        const dueAtTime = row.querySelector('.period-due-at')?.value || '';
        if (
            parseTimeToMinutes(start) !== null
            && parseTimeToMinutes(end) !== null
            && parseTimeToMinutes(dueAtTime) !== null
        ) {
            ranges.push({ start, end, dueAtTime });
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
            div.innerHTML = buildPeriodRowHtml('', '', '');
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
 *  • Due policy     → Highest-permission class wins.
 *                     Permission score priority:
 *                     canSignOut (4) + canCreateProjects (2) + canJoinProjects (1).
 *                     If a project has class_id and the student belongs to it,
 *                     that class due policy is used directly.
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
        if (itemTags.length === 0) return false;
        return itemTags.some(tag => allowed.has(tag));
    }).length;
}

function canUserSeeItem(user, item) {
    if (!user) return false;
    if (user.role !== 'student') return true;

    const classes = getStudentClassesForUser(user.id);
    if (classes.length === 0) return false;

    // Tag-only visibility model:
    // - Untagged items are hidden from students.
    // - Tagged items are visible if ANY class allows ANY matching tag.
    const itemTags = item.visibilityTags || [];
    if (itemTags.length === 0) return false;

    return classes.some(cls => {
        const allowed = cls.allowedVisibilityTags || [];
        return itemTags.some(tag => allowed.includes(tag));
    });
}

function getProjectStatusBadgeClass(status) {
    if (status === 'Completed') return 'status-project-completed';
    if (status === 'Archived') return 'status-project-archived';
    return 'status-instock';
}

function applyVersionBadges() {
    const loginVersionEl = document.getElementById('app-version-login');
    if (loginVersionEl) {
        loginVersionEl.textContent = appVersion;
        loginVersionEl.style.display = appVersion ? '' : 'none';
    }
}

function updateAppInfoOverlayVisibility() {
    const infoOverlay = document.querySelector('.app-info-overlay');
    if (!infoOverlay) return;
    infoOverlay.style.display = currentUser ? 'none' : '';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isSafeHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;

    try {
        const parsed = new URL(raw, window.location.origin);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function normalizeSkuToken(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function isSkuInUse(sku, excludeItemId = null) {
    const target = normalizeSkuToken(sku);
    if (!target) return false;
    return inventoryItems.some(item => {
        if (excludeItemId && item.id === excludeItemId) return false;
        return normalizeSkuToken(item.sku) === target;
    });
}

function openAppInfoMenu() {
    const popupHeading = String(envConfig.INFO_POPUP_HEADING || 'System Information').trim();
    const licenseStatusLabel = !appLicenseState.checked
        ? 'Not checked'
        : appLicenseState.valid
            ? 'Valid'
            : 'Invalid';

    const buildInfoText = String(envConfig.INFO_POPUP_BUILD_INFO || '').trim() ||
        `App: ${appName} Inventory System\nVersion: ${appVersion}\nKiosk ID: ${kioskId || 'Not set'}\nLicense Status: ${licenseStatusLabel}`;

    const sectionValues = [
        {
            subheading: String(envConfig.INFO_POPUP_SUBHEADING_1 || '').trim(),
            description: String(envConfig.INFO_POPUP_DESCRIPTION_1 || '').trim()
        },
        {
            subheading: String(envConfig.INFO_POPUP_SUBHEADING_2 || '').trim(),
            description: String(envConfig.INFO_POPUP_DESCRIPTION_2 || '').trim()
        },
        {
            subheading: String(envConfig.INFO_POPUP_SUBHEADING_3 || '').trim(),
            description: String(envConfig.INFO_POPUP_DESCRIPTION_3 || '').trim()
        },
        {
            subheading: 'Build Information',
            description: buildInfoText
        }
    ].filter(section => section.subheading || section.description);

    const popupSectionsHtml = sectionValues.length > 0
        ? sectionValues.map(section => `
            <div class="glass-panel" style="padding:0.9rem;border-radius:var(--radius-sm);margin-bottom:0.7rem;">
                ${section.subheading ? `<h4 style="margin-bottom:0.4rem;color:var(--text-primary);">${escapeHtml(section.subheading)}</h4>` : ''}
                ${section.description ? `<p class="text-muted" style="font-size:0.88rem;line-height:1.45;white-space:pre-wrap;">${escapeHtml(section.description)}</p>` : ''}
            </div>
        `).join('')
        : `<p class="text-muted">No popup content configured in env.js.</p>`;

    const html = `
        <div class="modal-header debug-modal-header">
            <h3 style="color:#a78bfa"><i class="ph ph-info"></i> ${escapeHtml(popupHeading)}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="debug-modal-body">
            <div class="glass-panel" style="padding:0.85rem;border-radius:var(--radius-sm);margin-bottom:0.8rem;display:flex;justify-content:space-between;gap:0.75rem;align-items:center;">
                <span class="text-muted" style="font-size:0.82rem;">${escapeHtml(appName)} Inventory System</span>
                <span class="badge">${escapeHtml(appVersion)}</span>
            </div>
            ${popupSectionsHtml}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    openModal(html);
    dynamicModal.classList.add('debug-modal');
}

function bindAppInfoTriggers() {
    document.getElementById('app-login-name')?.addEventListener('click', openAppInfoMenu);
    document.getElementById('app-sidebar-name')?.addEventListener('click', openAppInfoMenu);
    document.getElementById('app-info-trigger')?.addEventListener('click', openAppInfoMenu);
    document.getElementById('app-version-login')?.addEventListener('click', openAppInfoMenu);
}

function normalizeLicenseStatus(status) {
    return String(status || '').trim().toLowerCase();
}

function getLicenseUnavailableDescription(licenseStatus) {
    const normalized = normalizeLicenseStatus(licenseStatus);
    if (normalized === 'suspended' || normalized === 'supspended') {
        return 'Kiosk Unavailable. License Suspended';
    }
    if (normalized === 'expired') {
        return 'License expired, please renew your license';
    }
    if (normalized === 'offline') {
        return 'Kiosk is offline. Routine maintenence may be underway, check your internet connection';
    }
    if (normalized === 'admin') {
        return 'This kiosk has been disabled by a system administrator';
    }
    if (normalized === 'disabled') {
        return 'This Kiosk is disabled';
    }
    if (normalized === 'terminated') {
        return 'Your license is unavailable or has been terminated.';
    }
    return 'This kiosk is temporarily unavailable. Please check back shortly.';
}

function getLicenseFailureMessage(reason, licenseStatus = '') {
    if (reason === 'invalid_id') return 'Kiosk disabled: invalid organization ID.';
    if (reason === 'invalid_license') return getLicenseUnavailableDescription(licenseStatus);
    return 'Kiosk disabled: license verification failed.';
}

async function verifyOrganizationLicense(preferredOrganizationId = '') {
    const organizationId = String(preferredOrganizationId || runtimeOrganizationId || '').trim();
    if (organizationId) runtimeOrganizationId = organizationId;

    if (!organizationId) {
        appLicenseState = {
            checked: true,
            configured: false,
            valid: false,
            expectedHash: '',
            providedHash: '',
            message: 'Organization ID is not configured.'
        };
        appLicenseBlocked = true;
        return {
            valid: false,
            reason: 'invalid_id',
            resolvedLicenseStatus: '',
            message: getLicenseFailureMessage('invalid_id')
        };
    }

    const client = getSettingsSupabaseClient();
    if (!client) {
        appLicenseState = {
            checked: true,
            configured: true,
            valid: false,
            expectedHash: '',
            providedHash: '',
            message: 'Database client is unavailable for license verification.'
        };
        appLicenseBlocked = true;
        return {
            valid: false,
            reason: 'verification_error',
            resolvedLicenseStatus: '',
            message: getLicenseFailureMessage('verification_error')
        };
    }

    try {
        const { data, error } = await client.rpc('verify_kiosk_license', {
            p_organization_id: organizationId
        });

        if (error) {
            console.warn('verify_kiosk_license RPC failed:', error);
            appLicenseState = {
                checked: true,
                configured: true,
                valid: false,
                expectedHash: '',
                providedHash: '',
                message: 'License verification RPC failed.'
            };
            appLicenseBlocked = true;
            return {
                valid: false,
                reason: 'verification_error',
                resolvedLicenseStatus: '',
                message: getLicenseFailureMessage('verification_error')
            };
        }

        const row = Array.isArray(data) ? data[0] : data;
        const reason = String(row?.reason || '').trim() || 'verification_error';
        const resolvedLicenseStatus = String(row?.resolved_license_status || '').trim();
        const valid = row?.allowed === true && reason === 'ok';

        appLicenseState = {
            checked: true,
            configured: true,
            valid,
            expectedHash: '',
            providedHash: '',
            message: valid
                ? `Organization license verified (${String(row?.organization_name || 'Unknown organization')}).`
                : getLicenseFailureMessage(reason)
        };
        appLicenseBlocked = !valid;

        return {
            valid,
            reason,
            resolvedLicenseStatus,
            message: valid ? 'Organization license verified.' : getLicenseFailureMessage(reason, resolvedLicenseStatus)
        };
    } catch (error) {
        console.warn('Unexpected verify_kiosk_license error:', error);
        appLicenseState = {
            checked: true,
            configured: true,
            valid: false,
            expectedHash: '',
            providedHash: '',
            message: 'Unexpected license verification failure.'
        };
        appLicenseBlocked = true;
        return {
            valid: false,
            reason: 'verification_error',
            resolvedLicenseStatus: '',
            message: getLicenseFailureMessage('verification_error')
        };
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

    applyBrandImage('app-login-logo-image', 'app-login-name', appLogoUrl, `${appName} logo`);
    applyBrandImage('app-sidebar-logo-image', 'app-sidebar-name', appSidebarLogoUrl, `${appName} logo`);
}

function isValidBrandImageUrl(url) {
    if (!url) return false;
    return /^https?:\/\//i.test(url)
        || /^data:image\//i.test(url)
        || url.startsWith('/')
        || url.startsWith('./')
        || url.startsWith('../');
}

function applyBrandImage(imageId, textId, imageUrl, altText) {
    const imageEl = document.getElementById(imageId);
    const textEl = document.getElementById(textId);
    if (!imageEl || !textEl) return;

    if (!isValidBrandImageUrl(imageUrl)) {
        imageEl.classList.add('hidden');
        textEl.classList.remove('hidden');
        return;
    }

    imageEl.src = imageUrl;
    imageEl.alt = altText || appName;
    imageEl.classList.remove('hidden');
    textEl.classList.add('hidden');

    imageEl.onerror = () => {
        imageEl.classList.add('hidden');
        textEl.classList.remove('hidden');
    };
}

function setRuntimeAppVersion(version) {
    const normalized = String(version || '').trim() || 'VERSION';
    appVersion = normalized;
    window.RUNTIME_APP_VERSION = normalized;
    applyVersionBadges();
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

function getSettingsSupabaseClient() {
    if (typeof dbClient !== 'undefined' && dbClient) return dbClient;

    const { SUPABASE_URL, SUPABASE_KEY } = envConfig;
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;

    if (isUnsafeClientSupabaseKey(SUPABASE_KEY)) {
        console.error('Refusing to initialize browser Supabase client with service role key. Configure anon key in env.js.');
        return null;
    }

    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function fetchKioskSettings(targetKioskId = kioskId) {
    const fallbackVersion = String(envConfig.APP_VERSION ?? envConfig.APP_Version ?? 'VERSION').trim() || 'VERSION';
    const fallback = {
        app_version: fallbackVersion,
        organization_id: runtimeOrganizationId,
        is_locked: false,
        lock_screen: 'systemLocked',
        debug_menu_pin_hash: null
    };

    if (!targetKioskId) return fallback;

    const client = getSettingsSupabaseClient();
    if (!client) return fallback;

    try {
        const { data, error } = await client
            .from('kiosk_settings')
            .select('*')
            .eq('kiosk_id', targetKioskId)
            .maybeSingle();

        if (error) {
            console.warn('Failed to fetch kiosk settings:', error);
            return fallback;
        }

        return {
            app_version: String(data?.app_version || '').trim() || fallbackVersion,
            organization_id: String(data?.organization_id || runtimeOrganizationId || '').trim(),
            is_locked: !!(data?.is_locked ?? data?.kiosk_locked),
            lock_screen: String(data?.lock_screen || data?.kiosk_lock_screen || 'systemLocked'),
            debug_menu_pin_hash: String(data?.debug_menu_pin_hash || data?.debug_menu_pin || '').trim() || null
        };
    } catch (error) {
        console.warn('Unexpected error fetching kiosk settings:', error);
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

async function handleRemoteKioskSettingsChange(nextSettings = {}) {
    const wasBlocked = appLicenseBlocked;
    const normalized = String(nextSettings.app_version || '').trim();

    const verification = await verifyOrganizationLicense(nextSettings.organization_id);
    if (!verification.valid) {
        const unavailableDescription = verification.reason === 'invalid_license'
            ? getLicenseUnavailableDescription(verification.resolvedLicenseStatus)
            : '';
        await applyKioskLock(true, 'kioskUnavailable', { customDescription: unavailableDescription });
        showToast(verification.message, 'error');
        return;
    }

    if (wasBlocked && !appLicenseBlocked) {
        window.location.reload();
        return;
    }

    if (normalized && normalized !== appVersion) {
        setRuntimeAppVersion(normalized);

        const action = String(envConfig.APP_UPDATE_ACTION || 'reload').trim().toLowerCase();
        if (action === 'overlay') {
            showNewUpdateOverlay(normalized);
        } else {
            window.location.reload();
        }
    }

    if (typeof nextSettings.is_locked === 'boolean' || nextSettings.lock_screen) {
        const remoteLocked = !!nextSettings.is_locked;
        const remoteLockScreen = String(nextSettings.lock_screen || 'systemLocked');
        kioskLiveStatus.lastKnownLockState = remoteLocked;
        kioskLiveStatus.lastKnownLockScreen = remoteLockScreen;
        kioskLiveStatus.lastSyncAt = new Date().toISOString();
        await applyKioskLock(remoteLocked, remoteLockScreen);
    }

    if (Object.prototype.hasOwnProperty.call(nextSettings || {}, 'debug_menu_pin_hash')) {
        const remotePinHash = String(nextSettings.debug_menu_pin_hash || '').trim();
        debugConfig.pinHash = remotePinHash || null;
        try {
            if (remotePinHash) localStorage.setItem('debugMenuPinHash', remotePinHash);
            else localStorage.removeItem('debugMenuPinHash');
        } catch {
            // Ignore storage failures.
        }
    }
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
        }, async payload => {
            const next = {
                app_version: payload?.new?.app_version,
                organization_id: payload?.new?.organization_id,
                is_locked: payload?.new?.is_locked ?? payload?.new?.kiosk_locked,
                lock_screen: payload?.new?.lock_screen || payload?.new?.kiosk_lock_screen,
                debug_menu_pin_hash: payload?.new?.debug_menu_pin_hash || payload?.new?.debug_menu_pin
            };
            await handleRemoteKioskSettingsChange(next);
        })
        .subscribe(status => {
            kioskLiveStatus.realtimeConnected = status === 'SUBSCRIBED';
            if (status === 'CHANNEL_ERROR') {
                console.warn('kiosk_settings app_version realtime channel error');
            }
        });
}

async function syncKioskLockStateToSupabase(lock, screenKey) {
    if (!kioskId) return;
    const client = getSettingsSupabaseClient();
    if (!client) return;

    const primaryPayload = {
        kiosk_id: kioskId,
        is_locked: !!lock,
        lock_screen: screenKey || 'systemLocked'
    };

    const { error } = await client
        .from('kiosk_settings')
        .upsert([primaryPayload], { onConflict: 'kiosk_id' });

    if (!error) return;

    const fallbackPayload = {
        kiosk_id: kioskId,
        kiosk_locked: !!lock,
        kiosk_lock_screen: screenKey || 'systemLocked'
    };

    const { error: fallbackError } = await client
        .from('kiosk_settings')
        .upsert([fallbackPayload], { onConflict: 'kiosk_id' });

    if (fallbackError) {
        console.warn('Failed to sync kiosk lock state to Supabase:', fallbackError);
    }
}

async function hashDebugPin(pinValue) {
    const value = String(pinValue || '').trim();
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
        // Fall through to non-crypto fallback.
    }

    // Lightweight fallback when WebCrypto is unavailable.
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return `fallback-${Math.abs(hash)}`;
}

async function saveDebugPinHashToSupabase(pinHash, targetKioskId = kioskId) {
    const normalizedHash = String(pinHash || '').trim();
    if (!normalizedHash || !targetKioskId) return false;

    const client = getSettingsSupabaseClient();
    if (!client) return false;

    const primaryPayload = {
        kiosk_id: targetKioskId,
        debug_menu_pin_hash: normalizedHash
    };

    const { error } = await client
        .from('kiosk_settings')
        .upsert([primaryPayload], { onConflict: 'kiosk_id' });

    if (!error) return true;

    const fallbackPayload = {
        kiosk_id: targetKioskId,
        debug_menu_pin: normalizedHash
    };

    const { error: fallbackError } = await client
        .from('kiosk_settings')
        .upsert([fallbackPayload], { onConflict: 'kiosk_id' });

    if (fallbackError) {
        console.warn('Failed to save debug PIN hash to Supabase:', fallbackError);
        return false;
    }

    return true;
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

        const projectedTotalQty = inventoryBasket.reduce((sum, entry) => sum + entry.qty, 0) + 1;
        const constraintError = exceedsCheckoutConstraints({
            distinctItems: inventoryBasket.length,
            totalQuantity: projectedTotalQty
        });
        if (constraintError) {
            showToast(constraintError, 'error');
            return;
        }
        existing.qty++;
    } else {
        const projectedTotalQty = inventoryBasket.reduce((sum, entry) => sum + entry.qty, 0) + 1;
        const constraintError = exceedsCheckoutConstraints({
            distinctItems: inventoryBasket.length + 1,
            totalQuantity: projectedTotalQty
        });
        if (constraintError) {
            showToast(constraintError, 'error');
            return;
        }
        inventoryBasket.push({ id: item.id, name: item.name, qty: 1 });
    }

    showToast(`Added ${item.name} to basket`, 'success');
    renderBasket();
}

function setBasketItemQuantity(itemId, requestedQty) {
    const basketEntry = inventoryBasket.find(b => b.id === itemId);
    const item = inventoryItems.find(i => i.id === itemId);
    if (!basketEntry || !item) return;

    const clampedQty = Math.max(1, Math.min(item.stock, parseInt(requestedQty, 10) || 1));
    basketEntry.qty = clampedQty;
    renderBasket();
}

function adjustBasketItemQuantity(itemId, delta) {
    const basketEntry = inventoryBasket.find(b => b.id === itemId);
    if (!basketEntry) return;
    setBasketItemQuantity(itemId, basketEntry.qty + delta);
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
                    <div class="font-bold text-sm">${escapeHtml(item.name)}</div>
                    <div class="text-xs text-muted" style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
                        <span>Quantity:</span>
                        <button class="icon-btn basket-qty-minus" data-id="${escapeHtml(item.id)}" title="Decrease quantity" style="width:24px;height:24px;min-width:24px;"><i class="ph ph-minus"></i></button>
                        <input type="number" min="1" class="form-control basket-qty-input" data-id="${escapeHtml(item.id)}" value="${item.qty}" style="width:68px;padding:0.2rem 0.35rem;height:auto;text-align:center;">
                        <button class="icon-btn basket-qty-plus" data-id="${escapeHtml(item.id)}" title="Increase quantity" style="width:24px;height:24px;min-width:24px;"><i class="ph ph-plus"></i></button>
                    </div>
                </div>
                <button class="icon-btn text-danger" onclick="removeFromBasket('${escapeHtml(item.id)}')">
                    <i class="ph ph-minus-circle"></i>
                </button>
            </div>
        `).join('');

        const total = inventoryBasket.reduce((sum, item) => sum + item.qty, 0);
        totalQtyEl.textContent = total;
        checkoutBtn.disabled = false;

        list.querySelectorAll('.basket-qty-minus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                adjustBasketItemQuantity(id, -1);
            });
        });

        list.querySelectorAll('.basket-qty-plus').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                adjustBasketItemQuantity(id, 1);
            });
        });

        list.querySelectorAll('.basket-qty-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                setBasketItemQuantity(id, e.currentTarget.value);
            });
        });
    }

    // Populate projects
    const myProjects = projects.filter(p => (p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id)) && !String(p.id || '').startsWith('PERS-'));
    projSelect.innerHTML = '<option value="">My Items (Personal)</option>' +
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
        : 'My Items (Personal)';

    const projectedDueDate = new Date(calculateDueDate(new Date(), currentUser, selectedProject));

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
            name: 'My Items (Personal)',
            ownerId: userId,
            collaborators: [],
            itemsOut: [],
            status: 'Active'
        };
        projects.push(personalProject);
    } else {
        personalProject.name = 'My Items (Personal)';
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

    const totalQuantity = inventoryBasket.reduce((sum, entry) => sum + (parseInt(entry.qty, 10) || 0), 0);
    const constraintError = exceedsCheckoutConstraints({
        distinctItems: inventoryBasket.length,
        totalQuantity
    });
    if (constraintError) {
        showToast(constraintError, 'error');
        return;
    }

    if (!project) {
        showToast('Unable to resolve checkout destination project.', 'error');
        return;
    }

    if (project.id.startsWith('PERS-')) {
        const ensured = await ensureProjectExistsInSupabase(project);
        if (!ensured) {
            showToast('Failed to create personal project in database.', 'error');
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
            const signoutData = {
                id: generateId('OUT'),
                itemId: item.id,
                quantity: basketItem.qty,
                signoutDate: new Date().toISOString(),
                dueDate: calculateDueDate(new Date(), currentUser, project),
                assignedToUserId: project.ownerId,
                signedOutByUserId: currentUser.id
            };

            const savedSignout = await addProjectItemOutToSupabase({
                id: signoutData.id,
                projectId: project.id,
                itemId: item.id,
                quantity: basketItem.qty,
                signoutDate: signoutData.signoutDate,
                dueDate: signoutData.dueDate,
                assignedToUserId: signoutData.assignedToUserId,
                signedOutByUserId: signoutData.signedOutByUserId
            });

            if (!savedSignout) {
                const errDetail = typeof getLastProjectItemOutError === 'function'
                    ? String(getLastProjectItemOutError() || '').slice(0, 180)
                    : '';
                showToast(
                    `Checkout failed while creating sign-out for ${item.name}. ${errDetail || 'No stock was changed for that item.'}`,
                    'error'
                );
                await Promise.all([refreshProjectsFromSupabase(), refreshInventoryFromSupabase()]);
                renderInventory();
                renderDashboard();
                renderProjects();
                return;
            }

            const nextStock = item.stock - basketItem.qty;
            const stockUpdated = await updateItemInSupabase(item.id, { stock: nextStock });
            if (!stockUpdated) {
                if (savedSignout?.id) {
                    await returnItemToSupabase(savedSignout.id);
                } else {
                    await returnItemByCompositeToSupabase({
                        projectId: project.id,
                        itemId: item.id,
                        signoutDate: signoutData.signoutDate,
                        quantity: signoutData.quantity
                    });
                }
                showToast(`Checkout failed while updating stock for ${item.name}. Sign-out was rolled back.`, 'error');
                await Promise.all([refreshProjectsFromSupabase(), refreshInventoryFromSupabase()]);
                renderInventory();
                renderDashboard();
                renderProjects();
                return;
            }

            item.stock = nextStock;
            signoutData.id = savedSignout?.id || signoutData.id;
            project.itemsOut.push(signoutData);
            _trackItemSignout(item, basketItem.qty);

            if (project.id.startsWith('PERS-')) {
                addLog(currentUser.id, 'Personal Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} to self`);
            } else {
                addLog(currentUser.id, 'Project Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} for project ${project.name}`);
            }
        }
    }

    inventoryBasket = [];
    await Promise.all([refreshProjectsFromSupabase(), refreshInventoryFromSupabase()]);
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
    loadPolicyConfig();
    loadKioskManageConfig();
    applyBranding();
    applyKioskManageBranding();
    bindAppInfoTriggers();
    updateAppInfoOverlayVisibility();

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        showToast('Database client failed to load. Check connection and reload.', 'error');
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

    const kioskSettings = await fetchKioskSettings(kioskId);
    kioskLiveStatus.lastSyncAt = new Date().toISOString();
    kioskLiveStatus.lastSettingsVersion = String(kioskSettings.app_version || '').trim();
    kioskLiveStatus.lastKnownLockState = !!kioskSettings.is_locked;
    kioskLiveStatus.lastKnownLockScreen = String(kioskSettings.lock_screen || 'systemLocked');
    debugConfig.pinHash = String(kioskSettings.debug_menu_pin_hash || '').trim() || null;
    if (!debugConfig.pinHash) {
        try {
            debugConfig.pinHash = String(localStorage.getItem('debugMenuPinHash') || '').trim() || null;
        } catch {
            // Ignore storage failures.
        }
    }
    const organizationId = String(kioskSettings.organization_id || runtimeOrganizationId || '').trim();
    const verification = await verifyOrganizationLicense(organizationId);
    setRuntimeAppVersion(kioskSettings.app_version);
    await applyKioskLock(!!kioskSettings.is_locked, kioskSettings.lock_screen || 'systemLocked');
    startKioskVersionRealtimeListener(kioskId);

    if (!verification.valid) {
        const unavailableDescription = verification.reason === 'invalid_license'
            ? getLicenseUnavailableDescription(verification.resolvedLicenseStatus)
            : '';
        await applyKioskLock(true, 'kioskUnavailable', { customDescription: unavailableDescription });
        showToast(verification.message, 'error');
        return;
    }

    // Load all data from Supabase tables before initializing the app
    try {
        await loadAllData();
    } catch (error) {
        console.error('Initial Supabase load failed:', error);
        showToast('Unable to load data from server. Login may not work until this is fixed.', 'error');
    }

    // Bring focus to the primary login field for the current app mode.
    if (isManageMode) {
        usernameInput?.focus();
    } else if (barcodeInput) {
        barcodeInput.focus();
        document.addEventListener('click', (e) => {
            const modalOpen = modalContainer && !modalContainer.classList.contains('hidden');
            if (modalOpen) return;

            const target = e.target;
            const isInteractive = target?.closest?.('input, textarea, select, button, [contenteditable="true"]');
            if (isInteractive) return;

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
            if (isManageMode) usernameInput?.focus();
            else barcodeInput?.focus();
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
    if (isManageMode) {
        await handleManageCredentialLogin(usernameInput?.value || '', passwordInput?.value || '');
        return;
    }

    const id = String(rawId || '').trim().toUpperCase();
    if (barcodeInput) barcodeInput.value = '';

    if (currentUser) {
        await handleInSessionBarcodeScan(id);
        return;
    }

    if (!id) {
        showToast('Enter or scan a user ID or Item Barcode.', 'error');
        return;
    }

    if (typeof fetchUserByIdFromSupabase !== 'function') {
        showToast('Data module is not loaded. Refresh and verify script loading.', 'error');
        return;
    }

    if (!checkLoginRateLimit()) return;

    try {
        const loginResult = await loginWithBarcode(id);
        if (loginResult.error) {
            recordFailedLoginAttempt();
            addLog('SYSTEM', 'Login Failed', `Barcode login failed for input ${id}. Reason: ${loginResult.error || 'Unknown'}`);
            showToast(loginResult.error || 'Login failed', 'error');
            return;
        }

        const user = loginResult.user || null;
        if (user) {
            const appMode = String(window.APP_ENV?.APP_MODE || '').trim().toLowerCase();
            if (appMode === 'manage' && user.role === 'student') {
                showToast('Management console access is restricted to teachers and developers.', 'error');
                return;
            }

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
                return;
            }

            loadAllData().catch(loadError => {
                console.error('Post-login load failed:', loadError);
                showToast('Signed in, but data refresh failed.', 'warning');
            });
            return;
        }

        recordFailedLoginAttempt();
        addLog('SYSTEM', 'Login Failed', `Barcode login failed for input ${id}. Reason: Invalid barcode scanned.`);
        showToast('Invalid barcode scanned.', 'error');
    } catch (error) {
        console.error('Login lookup failed:', error);
        showToast('Database lookup failed during login.', 'error');
    }
}

async function handleManageCredentialLogin(rawUsername, rawPassword) {
    if (!isManageMode) return;
    if (currentUser) return;
    if (loginRequestInFlight) return;

    const username = String(rawUsername || '').trim();
    const password = String(rawPassword || '').trim();

    if (!username || !password) {
        showToast('Enter your username and authentication password.', 'error');
        return;
    }

    if (typeof loginWithUsernameAndPassword !== 'function') {
        showToast('Credential login module is not loaded. Refresh and verify script loading.', 'error');
        return;
    }

    if (!checkLoginRateLimit()) return;
    loginRequestInFlight = true;
    if (loginSubmitBtn) loginSubmitBtn.disabled = true;

    try {
        const loginResult = await loginWithUsernameAndPassword(username, password);
        if (loginResult.error) {
            recordFailedLoginAttempt();
            addLog('SYSTEM', 'Login Failed', `Credential login failed for identity ${username}. Reason: ${loginResult.error || 'Unknown'}`);
            showToast(loginResult.error || 'Login failed', 'error');
            return;
        }

        const user = loginResult.user || null;
        if (!user) {
            recordFailedLoginAttempt();
            addLog('SYSTEM', 'Login Failed', `Credential login failed for identity ${username}. Reason: Invalid username or password.`);
            showToast('Invalid username or password.', 'error');
            return;
        }
        if (passwordInput) passwordInput.value = '';

        await completeAuthenticatedSession(user);
    } catch (error) {
        console.error('Credential login lookup failed:', error);
        showToast('Database lookup failed during login.', 'error');
    } finally {
        loginRequestInFlight = false;
        if (loginSubmitBtn) loginSubmitBtn.disabled = false;
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

if (barcodeInput && !isManageMode) {
    barcodeInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' || e.key === 'NumpadEnter') {
            e.preventDefault();
            await handleBarcodeLogin(barcodeInput.value);
        }
    });
}

if (isManageMode) {
    loginSubmitBtn?.addEventListener('click', async () => {
        await handleManageCredentialLogin(usernameInput?.value || '', passwordInput?.value || '');
    });

    usernameInput?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' && e.key !== 'NumpadEnter') return;
        e.preventDefault();
        await handleManageCredentialLogin(usernameInput?.value || '', passwordInput?.value || '');
    });

    passwordInput?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter' && e.key !== 'NumpadEnter') return;
        e.preventDefault();
        await handleManageCredentialLogin(usernameInput?.value || '', passwordInput?.value || '');
    });
}

document.addEventListener('keydown', async (e) => {
    if (isManageMode) return;
    if (currentUser) return;
    if (loginView.classList.contains('hidden')) return;
    if (loginHelpView && !loginHelpView.classList.contains('hidden')) return;
    if (modalContainer && !modalContainer.classList.contains('hidden')) return;

    const active = document.activeElement;
    if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
    )) {
        return;
    }

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

let inSessionScanBuffer = '';
let inSessionScanTimer = null;

document.addEventListener('keydown', async (e) => {
    if (!currentUser) return;
    if (modalContainer && !modalContainer.classList.contains('hidden')) return;

    const active = document.activeElement;
    if (active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        active.tagName === 'SELECT' ||
        active.isContentEditable
    )) {
        return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        const code = inSessionScanBuffer.trim();
        inSessionScanBuffer = '';
        if (inSessionScanTimer) {
            clearTimeout(inSessionScanTimer);
            inSessionScanTimer = null;
        }
        if (code) {
            e.preventDefault();
            await handleInSessionBarcodeScan(code);
        }
        return;
    }

    if (e.key === 'Backspace') {
        if (inSessionScanBuffer.length > 0) {
            e.preventDefault();
            inSessionScanBuffer = inSessionScanBuffer.slice(0, -1);
        }
        return;
    }

    if (e.key.length === 1) {
        inSessionScanBuffer += e.key;
        if (inSessionScanTimer) clearTimeout(inSessionScanTimer);
        inSessionScanTimer = setTimeout(() => {
            inSessionScanBuffer = '';
        }, 300);
    }
});

// Enforce focus on barcode input when clicking anywhere on the login view (except buttons)
document.getElementById('login-view')?.addEventListener('click', (e) => {
    if (modalContainer && !modalContainer.classList.contains('hidden')) return;

    const target = e.target;
    const isInteractive = target?.closest?.('input, textarea, select, button, [contenteditable="true"]');

    if (!isInteractive) {
        if (isManageMode) {
            usernameInput?.focus();
        } else {
            barcodeInput?.focus();
        }
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

function setProfilePrivilegedActionState(isEnabled) {
    if (!userProfileEl) return;
    userProfileEl.classList.toggle('profile-action-enabled', !!isEnabled);
    if (isEnabled) {
        userProfileEl.setAttribute('title', 'Change Authentication Password');
        userProfileEl.setAttribute('role', 'button');
        userProfileEl.setAttribute('tabindex', '0');
    } else {
        userProfileEl.removeAttribute('title');
        userProfileEl.removeAttribute('role');
        userProfileEl.removeAttribute('tabindex');
    }
}

function login(user) {
    currentUser = user;
    privilegedSessionAuthenticated = false;
    privilegedStartupAuditShown = false;
    getOrCreatePersonalProject(user.id);
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
        navRequests?.classList.add('hidden');
        applyOrdersNavVisibility();
        document.getElementById('manage-categories-btn')?.classList.add('hidden');
        document.getElementById('manage-visibility-tags-btn')?.classList.add('hidden');
        document.getElementById('bulk-manage-items-btn')?.classList.add('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.add('hidden');
        setProfilePrivilegedActionState(false);
    } else {
        navLogs.classList.remove('hidden');
        navUsers.classList.remove('hidden');
        navClasses.classList.remove('hidden');
        navRequests?.classList.add('hidden');
        applyOrdersNavVisibility();
        document.getElementById('manage-categories-btn')?.classList.remove('hidden');
        document.getElementById('manage-visibility-tags-btn')?.classList.remove('hidden');
        document.getElementById('bulk-manage-items-btn')?.classList.remove('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.remove('hidden');
        setProfilePrivilegedActionState(true);
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

    // Hide OehlerOS version badge after login
    const versionOverlay = document.querySelector('.app-version-overlay');
    if (versionOverlay) versionOverlay.style.display = 'none';
    updateAppInfoOverlayVisibility();

    showToast(`Welcome, ${user.name}`);

    // Switch Views
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.classList.add('hidden');
        mainView.classList.remove('hidden');
        setTimeout(() => mainView.classList.add('active'), 50);

        // Load initial Dashboard from fresh Supabase state
        switchPage('dashboard', 'Dashboard').catch(err => console.error(err));

        // Run one-time authentication password setup audit for staff users.
        setTimeout(() => {
            runPrivilegedStartupAudit();
        }, 250);
    }, 300);
}

function logout(message = 'Logged out successfully') {
    if (!currentUser) {
        showToast(message);
        return;
    }

    closeModal();

    _trackLogout();
    currentUser = null;
    privilegedSessionAuthenticated = false;
    privilegedStartupAuditShown = false;
    inventoryBasket = [];
    toggleBasket(false);
    clearInterval(countdownInterval);
    mainView.classList.remove('active');
    setTimeout(() => {
        mainView.classList.add('hidden');
        loginView.classList.remove('hidden');
        // Keep nav selection aligned with the default landing page.
        setActiveNavForTarget('dashboard');
        // Show OehlerOS version badge on login screen
        const versionOverlay = document.querySelector('.app-version-overlay');
        if (versionOverlay) versionOverlay.style.display = '';
        updateAppInfoOverlayVisibility();
        setTimeout(() => {
            loginView.classList.add('active');
            if (isManageMode) usernameInput?.focus();
            else barcodeInput?.focus();
        }, 50);
    }, 300);
    showToast(message);
}

function returnToLoginView(options = {}) {
    const message = options.message || 'Logged out successfully';
    const showMessage = options.showMessage !== false;

    closeModal();

    if (currentUser) _trackLogout();
    currentUser = null;
    privilegedSessionAuthenticated = false;
    privilegedStartupAuditShown = false;
    inventoryBasket = [];
    toggleBasket(false);
    clearInterval(countdownInterval);

    mainView.classList.remove('active');
    loginHelpView.classList.remove('active');

    setTimeout(() => {
        mainView.classList.add('hidden');
        loginHelpView.classList.add('hidden');
        loginView.classList.remove('hidden');
        setActiveNavForTarget('dashboard');
        // Show OehlerOS version badge on login screen
        const versionOverlay = document.querySelector('.app-version-overlay');
        if (versionOverlay) versionOverlay.style.display = '';
        updateAppInfoOverlayVisibility();
        setTimeout(() => {
            loginView.classList.add('active');
            if (isManageMode) usernameInput?.focus();
            else barcodeInput?.focus();
        }, 50);
    }, 300);

    if (showMessage) showToast(message);
}

logoutBtn.addEventListener('click', () => logout());

function handleSidebarProfileAuthClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!currentUser || !userCanPerformPrivilegedActions()) return;

    const hasExistingPassword = !!getUserPrivilegedPasswordHash(currentUser);
    const reason = hasExistingPassword
        ? 'updating your authentication password'
        : 'setting your authentication password';

    promptSetPrivilegedActionPassword(reason, false);
}

userProfileEl?.addEventListener('click', handleSidebarProfileAuthClick);
userProfileEl?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    handleSidebarProfileAuthClick(event);
});

/* =======================================
   ROUTING
   ======================================= */
function setActiveNavForTarget(targetId) {
    navBtns.forEach(btn => {
        const isActive = btn.getAttribute('data-target') === targetId;
        btn.classList.toggle('active', isActive);
    });
}

function userCanPerformPrivilegedActions() {
    const normalizedRole = String(currentUser?.role || '').trim().toLowerCase();
    return !!currentUser && ['teacher', 'developer'].includes(normalizedRole);
}

function runPrivilegedStartupAudit() {
    if (privilegedStartupAuditShown) return;
    privilegedStartupAuditShown = true;

    if (!userCanPerformPrivilegedActions()) return;

    const privilegedHash = getUserPrivilegedPasswordHash(currentUser);
    if (privilegedHash) return;

    showToast('No authentication password set for this account. Click your profile in the sidebar to set one.', 'warning');
}

function getPrivilegedPasswordStorageKey(userId) {
    return `${privilegedPasswordStoragePrefix}${String(userId || '').trim().toUpperCase()}`;
}

function getUserPrivilegedPasswordHash(user) {
    if (!user) return '';

    return String(
        user.auth_password_hash
        || user.authentication_password_hash
        || user.privileged_password_hash
        || user.privileged_auth_password_hash
        || user.staff_password_hash
        || ''
    ).trim();
}

function setUserPrivilegedPasswordHash(userId, hashValue) {
    if (!userId) return;
    const normalizedUserId = String(userId).trim().toUpperCase();
    const normalizedHash = String(hashValue || '').trim();

    if (currentUser && String(currentUser.id || '').trim().toUpperCase() === normalizedUserId) {
        currentUser.privileged_password_hash = normalizedHash;
    }

    const target = mockUsers.find(u => String(u.id || '').trim().toUpperCase() === normalizedUserId);
    if (target) target.privileged_password_hash = normalizedHash;
}

function hasStaffPasswordHashConflict(passwordHash, excludeUserId = '') {
    const normalizedHash = String(passwordHash || '').trim();
    const normalizedExclude = String(excludeUserId || '').trim().toUpperCase();
    if (!normalizedHash) return false;

    return (mockUsers || []).some(user => {
        const role = String(user?.role || '').toLowerCase();
        if (!['teacher', 'developer'].includes(role)) return false;
        if (String(user?.id || '').trim().toUpperCase() === normalizedExclude) return false;
        return getUserPrivilegedPasswordHash(user) === normalizedHash;
    });
}

async function savePrivilegedPasswordHashForCurrentUser(hashValue) {
    const normalizedHash = String(hashValue || '').trim();
    if (!currentUser?.id || !normalizedHash) return false;

    let savedToSupabase = false;
    const payloadCandidates = [
        { privileged_password_hash: normalizedHash },
        { privileged_auth_password_hash: normalizedHash },
        { staff_password_hash: normalizedHash }
    ];

    if (typeof updateUserInSupabase === 'function') {
        for (const payload of payloadCandidates) {
            const updated = await updateUserInSupabase(currentUser.id, payload);
            if (!updated) continue;
            savedToSupabase = true;
            currentUser = { ...currentUser, ...updated, privileged_password_hash: normalizedHash };
            setUserPrivilegedPasswordHash(currentUser.id, normalizedHash);
            break;
        }
    }

    return savedToSupabase;
}

async function promptSetPrivilegedActionPassword(reason = 'this action', forcedReset = false) {
    if (!currentUser || !userCanPerformPrivilegedActions()) return false;

    return new Promise(resolve => {
        const resetHint = forcedReset
            ? 'Your current authentication password matches the debug PIN. Create a different password now.'
            : `Set an authentication password for ${escapeHtml(currentUser.name)} to continue with ${escapeHtml(reason)}.`;

        const html = `
            <div class="modal-header debug-modal-header">
                <h3 style="color:#a78bfa"><i class="ph ph-lock-key"></i> Set Authentication Password</h3>
                <button class="close-btn" id="priv-pass-close"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <p class="text-secondary mb-4">${resetHint}</p>
                <div class="form-group">
                    <label>Confirm Username or User Barcode</label>
                    <input type="text" id="priv-pass-identity" class="form-control" maxlength="120" autocomplete="username" placeholder="Enter your username or barcode" autofocus>
                </div>
                <div class="form-group">
                    <label>New Password <small>(min 6 characters)</small></label>
                    <input type="password" id="priv-pass-new" class="form-control" minlength="6" maxlength="64" autocomplete="new-password">
                </div>
                <div class="form-group">
                    <label>Confirm Password</label>
                    <input type="password" id="priv-pass-confirm" class="form-control" minlength="6" maxlength="64" autocomplete="new-password">
                </div>
                <small id="priv-pass-err" class="text-danger" style="display:none;margin-top:0.25rem"></small>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="priv-pass-cancel">Cancel</button>
                <button class="btn btn-primary" id="priv-pass-save">Save Password</button>
            </div>`;

        openModal(html);

        const finish = (result) => {
            closeModal();
            resolve(result);
        };

        const showErr = (msg) => {
            const errEl = document.getElementById('priv-pass-err');
            if (!errEl) return;
            errEl.style.display = '';
            errEl.textContent = msg;
        };

        const savePassword = async () => {
            const identityInput = String(document.getElementById('priv-pass-identity')?.value || '').trim();
            const p1 = String(document.getElementById('priv-pass-new')?.value || '').trim();
            const p2 = String(document.getElementById('priv-pass-confirm')?.value || '').trim();

            const normalizeUserToken = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
            const enteredToken = normalizeUserToken(identityInput);
            const expectedBarcode = normalizeUserToken(currentUser.id);
            const expectedUsername = normalizeUserToken(currentUser.name);

            if (!enteredToken) {
                showErr('Enter your username or user barcode to continue.');
                return;
            }

            if (enteredToken !== expectedBarcode && enteredToken !== expectedUsername) {
                showErr('Username or user barcode does not match your account.');
                return;
            }

            if (p1.length < 6) {
                showErr('Password must be at least 6 characters.');
                return;
            }
            if (p1 !== p2) {
                showErr('Passwords do not match.');
                return;
            }

            const passwordHash = await hashDebugPin(p1);
            if (!passwordHash) {
                showErr('Failed to generate password hash.');
                return;
            }

            if (debugConfig.pinHash && passwordHash === debugConfig.pinHash) {
                showErr('Password must be different from the debug PIN.');
                return;
            }

            if (hasStaffPasswordHashConflict(passwordHash, currentUser.id)) {
                showErr('This password is already used by another teacher/developer. Choose a different password.');
                return;
            }

            const savedToSupabase = await savePrivilegedPasswordHashForCurrentUser(passwordHash);
            if (!savedToSupabase) {
                showErr('Failed to save authentication password to server. Check your connection and permissions, then try again.');
                return;
            }

            privilegedSessionAuthenticated = true;
            showToast('Authentication password saved.', 'success');
            addLog(currentUser.id, 'Privileged Password Updated', 'Updated authentication password for privileged actions.');
            finish(true);
        };

        document.getElementById('priv-pass-save')?.addEventListener('click', savePassword);
        document.getElementById('priv-pass-identity')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            savePassword();
        });
        document.getElementById('priv-pass-new')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            savePassword();
        });
        document.getElementById('priv-pass-confirm')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            savePassword();
        });
        document.getElementById('priv-pass-cancel')?.addEventListener('click', () => finish(false));
        document.getElementById('priv-pass-close')?.addEventListener('click', () => finish(false));
    });
}

function requestPrivilegedActionAuth(reason = 'this action') {
    return new Promise(resolve => {
        const html = `
            <div class="modal-header debug-modal-header">
                <h3 style="color:#a78bfa"><i class="ph ph-lock-key"></i> Authentication Required</h3>
                <button class="close-btn" id="priv-auth-close"><i class="ph ph-x"></i></button>
            </div>
            <div class="modal-body">
                <p class="text-secondary mb-4">Enter your authentication password to continue with ${escapeHtml(reason)}.</p>
                <div class="form-group">
                    <input type="password" id="priv-auth-password" class="form-control" maxlength="64" autocomplete="current-password" placeholder="Password" autofocus>
                    <small id="priv-auth-err" class="text-danger" style="display:none;margin-top:0.25rem"></small>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="priv-auth-cancel">Cancel</button>
                <button class="btn btn-primary" id="priv-auth-confirm">Continue</button>
            </div>`;

        openModal(html);

        let attempts = 0;
        const finish = (result) => {
            closeModal();
            resolve(result);
        };

        const tryPassword = async () => {
            const expectedHash = getUserPrivilegedPasswordHash(currentUser);
            if (!expectedHash) {
                showToast('No authentication password is set for this account yet.', 'error');
                finish(false);
                return;
            }

            const enteredPassword = (document.getElementById('priv-auth-password')?.value || '').trim();
            attempts++;

            const enteredHash = await hashDebugPin(enteredPassword);
            if (enteredHash && enteredHash === expectedHash) {
                privilegedSessionAuthenticated = true;
                addLog(currentUser.id, 'Privileged Auth Success', `Privileged action authentication passed for ${reason}.`);
                showToast('Session authenticated.', 'success');
                finish(true);
                return;
            }

            const errEl = document.getElementById('priv-auth-err');
            if (errEl) {
                errEl.style.display = '';
                errEl.textContent = `Incorrect password. Attempt ${attempts}/5.`;
            }
            const passwordInput = document.getElementById('priv-auth-password');
            if (passwordInput) passwordInput.value = '';

            if (attempts >= 5) {
                showToast('Too many incorrect password attempts.', 'error');
                finish(false);
            }
        };

        document.getElementById('priv-auth-confirm')?.addEventListener('click', tryPassword);
        document.getElementById('priv-auth-password')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                tryPassword();
            }
        });
        document.getElementById('priv-auth-cancel')?.addEventListener('click', () => finish(false));
        document.getElementById('priv-auth-close')?.addEventListener('click', () => finish(false));
    });
}

async function ensurePrivilegedActionAuth(reason = 'this action') {
    if (!userCanPerformPrivilegedActions()) return true;
    if (privilegedSessionAuthenticated) return true;

    const privilegedHash = getUserPrivilegedPasswordHash(currentUser);
    if (!privilegedHash) {
        showToast('Set your authentication password to continue.', 'warning');
        return promptSetPrivilegedActionPassword(reason);
    }

    if (debugConfig.pinHash && privilegedHash === debugConfig.pinHash) {
        showToast('Authentication password cannot match the debug PIN. Please set a new password.', 'warning');
        return promptSetPrivilegedActionPassword(reason, true);
    }

    return requestPrivilegedActionAuth(reason);
}

navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const target = btn.getAttribute('data-target');
        const title = btn.textContent.trim();
        await switchPage(target, title);
    });
});

async function refreshPageDataFromSupabase(targetId) {
    if (targetId === 'requests') {
        await refreshPageDataFromSupabase('orders');
        return;
    }

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
    if (targetId === 'requests') {
        targetId = 'orders';
        title = 'Operations Hub';
        ordersTabMode = 'requests';
    }

    if (targetId === 'orders' && !canCurrentUserViewOrders()) {
        showToast('Orders view is disabled for students.', 'error');
        return;
    }

    if (['users', 'classes', 'logs'].includes(targetId)) {
        if (currentUser?.role === 'student') {
            showToast('You do not have access to that page.', 'error');
            return;
        }
        const authOk = await ensurePrivilegedActionAuth(`${title || targetId} page`);
        if (!authOk) return;
    }

    if (isBasketOpen && targetId !== 'inventory') {
        toggleBasket(false);
    }

    if (targetId !== 'users') {
        document.querySelector('#page-users .table-container')?.classList.remove('grid-view-active');
    }

    _trackPageVisit(targetId);
    pageTitle.textContent = title;
    setActiveNavForTarget(targetId);

    try {
        await refreshPageDataFromSupabase(targetId);
    } catch (error) {
        console.error(`Failed to refresh ${targetId} from Supabase:`, error);
        showToast(`Failed to refresh ${title} from server. Showing current data.`, 'error');
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
    if (targetId === 'logs') renderLogs();
    if (targetId === 'users') renderUsers();
    if (targetId === 'classes') renderClasses();
    if (targetId === 'orders') renderOrders();
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
                myItemsOut.push({ ...outItem, projectName: p.name, projectId: p.id });
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

        myItemsOut.sort((a, b) => {
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
            return aDue - bDue;
        });

        list1.replaceChildren();
        if (myItemsOut.length === 0) {
            const p = document.createElement('p');
            p.className = 'text-muted';
            p.textContent = 'No items currently signed out.';
            list1.appendChild(p);
        } else {
            myItemsOut.forEach(io => {
                const item = inventoryItems.find(i => i.id === io.itemId);
                const dueDate = io.dueDate ? new Date(io.dueDate) : null;
                const isOverdue = dueDate ? dueDate < new Date() : false;
                const dueLabel = dueDate ? dueDate.toLocaleString() : 'No due date';
                const safeItemId = escapeHtml(String(io.itemId || ''));
                const safeProjectName = escapeHtml(String(io.projectName || 'Unknown Project'));
                const safeDueDate = escapeHtml(String(io.dueDate || ''));
                const safeSignoutId = escapeHtml(String(io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`));
                const safeProjectId = escapeHtml(String(io.projectId || ''));
                const safeItemName = escapeHtml(String(item ? item.name : 'Unknown Item'));

                const li = document.createElement('li');
                li.className = 'stock-item';

                const left = document.createElement('div');
                const strong = document.createElement('strong');
                strong.textContent = `${safeItemName} (x${io.quantity})`;
                const spanProject = document.createElement('span');
                spanProject.className = 'text-muted block text-sm';
                spanProject.textContent = `Project: ${safeProjectName}`;
                left.appendChild(strong);
                left.appendChild(spanProject);

                const right = document.createElement('div');
                right.style.cssText = 'display:flex;align-items:center;gap:0.75rem';
                const spanDue = document.createElement('span');
                spanDue.className = `${isOverdue ? 'text-danger' : 'text-warning'} font-bold text-sm`;
                spanDue.textContent = isOverdue ? `Overdue (Due: ${dueLabel})` : `Due: ${dueLabel}`;

                const extendBtn = document.createElement('button');
                extendBtn.className = 'btn btn-secondary text-sm request-extension-btn';
                extendBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;';
                extendBtn.setAttribute('data-item-id', safeItemId);
                extendBtn.setAttribute('data-project', safeProjectName);
                extendBtn.setAttribute('data-due', safeDueDate);
                const extendIcon = document.createElement('i');
                extendIcon.className = 'ph ph-clock-clockwise';
                extendBtn.appendChild(extendIcon);
                extendBtn.appendChild(document.createTextNode(' Extend'));

                const returnBtn = document.createElement('button');
                returnBtn.className = 'btn btn-primary text-sm return-item-btn';
                returnBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;margin-left:0.5rem';
                returnBtn.setAttribute('data-project-item-out-id', safeSignoutId);
                returnBtn.setAttribute('data-project-id', safeProjectId);
                returnBtn.setAttribute('data-item-id', safeItemId);
                returnBtn.setAttribute('data-project', safeProjectName);
                const returnIcon = document.createElement('i');
                returnIcon.className = 'ph ph-arrow-u-down-left';
                returnBtn.appendChild(returnIcon);
                returnBtn.appendChild(document.createTextNode(' Return'));

                right.appendChild(spanDue);
                right.appendChild(extendBtn);
                right.appendChild(returnBtn);
                li.appendChild(left);
                li.appendChild(right);
                list1.appendChild(li);
            });
        }

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
                    showToast('Failed to submit extension request to database.', 'error');
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
                const projectId = e.currentTarget.getAttribute('data-project-id');
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

                const returned = await returnProjectItem(projectId, projectItemOutId, { skipConfirmPrompt: true });
                if (!returned) {
                    showToast('Failed to return item. Please try again.', 'error');
                    return;
                }
                renderDashboard();
            });
        });

        const widget2Title = document.getElementById('widget-2-title');
        if (widget2Title) widget2Title.textContent = 'My Items';

        const personalProject = projects.find(p => p.id === `PERS-${currentUser.id}`);
        const personalItems = personalProject?.itemsOut || [];

        list2.replaceChildren();
        if (personalItems.length === 0) {
            const p = document.createElement('p');
            p.className = 'text-muted';
            p.textContent = 'No personal items are currently signed out.';
            list2.appendChild(p);
        } else {
            personalItems.slice(0, 6).forEach(io => {
                const item = inventoryItems.find(i => i.id === io.itemId);
                const dueDate = io.dueDate ? new Date(io.dueDate) : null;
                const isOverdue = dueDate ? dueDate < now : false;
                const dueLabel = dueDate ? dueDate.toLocaleDateString() : 'No due date';
                const safeProjectId = escapeHtml(String(personalProject.id || ''));
                const safeItemLabel = escapeHtml(String(item ? item.name : io.itemId || 'Unknown Item'));

                const li = document.createElement('li');
                li.className = 'activity-item';
                const ts = document.createElement('div');
                ts.className = 'timestamp';
                ts.textContent = 'Personal';
                const row = document.createElement('div');
                const strong = document.createElement('strong');
                strong.textContent = safeItemLabel;
                row.appendChild(strong);
                row.appendChild(document.createTextNode(` · Qty: ${io.quantity}`));
                const due = document.createElement('div');
                due.className = 'text-muted text-sm';
                due.textContent = `${isOverdue ? 'Overdue' : 'Due'}: ${dueLabel}`;

                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;gap:0.5rem;margin-top:0.55rem;';
                const openBtn = document.createElement('button');
                openBtn.className = 'btn btn-secondary text-sm dashboard-project-open-btn';
                openBtn.style.cssText = 'padding:0.3rem 0.55rem;font-size:0.75rem;';
                openBtn.setAttribute('data-project-id', safeProjectId);
                const openIcon = document.createElement('i');
                openIcon.className = 'ph ph-folder-open';
                openBtn.appendChild(openIcon);
                openBtn.appendChild(document.createTextNode(' Open'));

                const itemsBtn = document.createElement('button');
                itemsBtn.className = 'btn btn-primary text-sm dashboard-project-items-btn';
                itemsBtn.style.cssText = 'padding:0.3rem 0.55rem;font-size:0.75rem;';
                itemsBtn.setAttribute('data-project-id', safeProjectId);
                const itemsIcon = document.createElement('i');
                itemsIcon.className = 'ph ph-list';
                itemsBtn.appendChild(itemsIcon);
                itemsBtn.appendChild(document.createTextNode(' Items'));

                actions.appendChild(openBtn);
                actions.appendChild(itemsBtn);
                li.appendChild(ts);
                li.appendChild(row);
                li.appendChild(due);
                li.appendChild(actions);
                list2.appendChild(li);
            });
        }

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

                while (tabContent.firstChild) {
                    tabContent.removeChild(tabContent.firstChild);
                }

                if (lowStockItems.length === 0) {
                    const p = document.createElement('p');
                    p.className = 'text-muted';
                    p.textContent = 'All stock levels are healthy.';
                    const ul = document.createElement('ul');
                    ul.className = 'stock-list';
                    ul.appendChild(p);
                    tabContent.appendChild(ul);
                } else {
                    const ul = document.createElement('ul');
                    ul.className = 'stock-list';
                    lowStockItems.forEach(item => {
                        const li = document.createElement('li');
                        li.className = 'stock-item';
                        const divContent = document.createElement('div');
                        const strong = document.createElement('strong');
                        strong.textContent = escapeHtml(item.name);
                        const span = document.createElement('span');
                        span.className = 'text-muted block text-sm';
                        span.textContent = `SKU: ${escapeHtml(item.sku)}`;
                        divContent.appendChild(strong);
                        divContent.appendChild(span);
                        const spanStock = document.createElement('span');
                        spanStock.className = 'text-danger font-bold';
                        spanStock.textContent = `${item.stock} left`;
                        li.appendChild(divContent);
                        li.appendChild(spanStock);
                        ul.appendChild(li);
                    });
                    tabContent.appendChild(ul);
                }
            } else if (tab === 'activity') {
                const recentLogs = activityLogs.slice(0, 8);

                while (tabContent.firstChild) {
                    tabContent.removeChild(tabContent.firstChild);
                }

                const ul = document.createElement('ul');
                ul.className = 'activity-list mini';

                recentLogs.forEach(log => {
                    const actorId = log.userId || log.user_id || '';
                    const user = mockUsers.find(u => u.id === actorId);
                    const displayName = user?.name || (actorId === 'SYSTEM' ? 'SYSTEM' : actorId) || 'Unknown';

                    const li = document.createElement('li');
                    li.className = 'activity-item';

                    const divTime = document.createElement('div');
                    divTime.className = 'timestamp';
                    divTime.textContent = new Date(log.timestamp).toLocaleString();

                    const divContent = document.createElement('div');
                    const roleIcon = document.createElement('span');
                    roleIcon.style.cssText = 'font-size:1rem;margin-right:0.3rem';
                    roleIcon.textContent = user?.role ? getRoleIcon(user.role) : '👤';
                    const strong = document.createElement('strong');
                    strong.textContent = escapeHtml(displayName);
                    const dash = document.createTextNode(` - ${escapeHtml(log.action)}`);

                    divContent.appendChild(roleIcon);
                    divContent.appendChild(strong);
                    divContent.appendChild(dash);

                    li.appendChild(divTime);
                    li.appendChild(divContent);
                    ul.appendChild(li);
                });

                tabContent.appendChild(ul);
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
                            projectId: p.id,
                            projectName: p.name,
                            userName: user ? user.name : p.ownerId
                        });
                    });
                });

                if (allItemsOut.length === 0) {
                    while (tabContent.firstChild) {
                        tabContent.removeChild(tabContent.firstChild);
                    }
                    const p = document.createElement('p');
                    p.className = 'text-muted';
                    p.textContent = 'No items currently signed out.';
                    tabContent.appendChild(p);
                } else {
                    while (tabContent.firstChild) {
                        tabContent.removeChild(tabContent.firstChild);
                    }
                    const ul = document.createElement('ul');
                    ul.className = 'stock-list';

                    allItemsOut.forEach(io => {
                        const dueDate = io.dueDate ? new Date(io.dueDate) : null;
                        const isOverdue = dueDate ? dueDate < new Date() : false;
                        const dueLabel = dueDate ? dueDate.toLocaleDateString() : 'No due date';
                        const isPersonal = String(io.projectId || '').startsWith('PERS-');

                        const li = document.createElement('li');
                        li.className = 'stock-item';

                        const divContent = document.createElement('div');
                        const strongName = document.createElement('strong');
                        strongName.style.display = 'block';
                        strongName.textContent = `${escapeHtml(io.itemName)} (x${io.quantity})`;
                        const smallSku = document.createElement('small');
                        smallSku.className = 'text-muted block';
                        smallSku.textContent = `SKU: ${escapeHtml(io.sku)}`;
                        const spanProject = document.createElement('span');
                        spanProject.className = 'text-muted block text-sm';

                        if (isPersonal) {
                            const textPart1 = document.createTextNode(escapeHtml(io.userName) + ' — ');
                            const spanAccent = document.createElement('span');
                            spanAccent.className = 'text-accent';
                            spanAccent.textContent = 'My Items (Personal)';
                            spanProject.appendChild(textPart1);
                            spanProject.appendChild(spanAccent);
                        } else {
                            spanProject.textContent = `${escapeHtml(io.userName)} — ${escapeHtml(io.projectName)}`;
                        }

                        divContent.appendChild(strongName);
                        divContent.appendChild(smallSku);
                        divContent.appendChild(spanProject);

                        const spanDue = document.createElement('span');
                        spanDue.className = `${isOverdue ? 'text-danger' : 'text-warning'} font-bold text-sm`;
                        spanDue.style.whiteSpace = 'nowrap';
                        spanDue.textContent = isOverdue ? `Overdue (Due: ${dueLabel})` : `Due: ${dueLabel}`;

                        li.appendChild(divContent);
                        li.appendChild(spanDue);
                        ul.appendChild(li);
                    });

                    tabContent.appendChild(ul);
                }
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

                while (tabContent.firstChild) {
                    tabContent.removeChild(tabContent.firstChild);
                }

                if (summaryRows.length === 0) {
                    const p = document.createElement('p');
                    p.className = 'text-muted';
                    p.textContent = 'No projects currently have items signed out.';
                    tabContent.appendChild(p);
                } else {
                    const ul = document.createElement('ul');
                    ul.className = 'stock-list';

                    summaryRows.forEach(row => {
                        const li = document.createElement('li');
                        li.className = 'stock-item dashboard-project-summary';
                        li.style.cssText = 'gap:0.75rem;align-items:flex-start;';

                        const divContent = document.createElement('div');
                        const strong = document.createElement('strong');
                        strong.textContent = escapeHtml(row.name);
                        const smallOwner = document.createElement('small');
                        smallOwner.className = 'text-muted block';
                        smallOwner.textContent = `Owner: ${escapeHtml(row.owner)}`;
                        const smallStats = document.createElement('small');
                        smallStats.className = 'text-muted block';
                        smallStats.textContent = `Out: ${row.outQty} · Due now: ${row.dueQty}`;

                        divContent.appendChild(strong);
                        divContent.appendChild(smallOwner);
                        divContent.appendChild(smallStats);
                        li.appendChild(divContent);

                        const divActions = document.createElement('div');
                        divActions.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end;';

                        const openBtn = document.createElement('button');
                        openBtn.className = 'btn btn-secondary text-sm dashboard-project-open-btn';
                        openBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.75rem;';
                        openBtn.setAttribute('data-project-id', escapeHtml(row.id));
                        const openIcon = document.createElement('i');
                        openIcon.className = 'ph ph-folder-open';
                        openBtn.appendChild(openIcon);
                        openBtn.appendChild(document.createTextNode(' Open'));

                        const itemsBtn = document.createElement('button');
                        itemsBtn.className = 'btn btn-primary text-sm dashboard-project-items-btn';
                        itemsBtn.style.cssText = 'padding:0.25rem 0.5rem;font-size:0.75rem;';
                        itemsBtn.setAttribute('data-project-id', escapeHtml(row.id));
                        const itemsIcon = document.createElement('i');
                        itemsIcon.className = 'ph ph-list';
                        itemsBtn.appendChild(itemsIcon);
                        itemsBtn.appendChild(document.createTextNode(' Items'));

                        divActions.appendChild(openBtn);
                        divActions.appendChild(itemsBtn);
                        li.appendChild(divActions);
                        ul.appendChild(li);
                    });

                    tabContent.appendChild(ul);
                }

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

function renderDashboard() {
     loadDashboard();
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

function getItemRecentUsers(item, limit = 5) {
    if (!item) return [];
    const itemId = item.id;
    const allSignouts = [];
    projects.forEach(project => {
        (project.itemsOut || []).forEach(io => {
            if (io.itemId !== itemId) return;
            allSignouts.push({
                assignedToUserId: io.assignedToUserId || null,
                signedOutByUserId: io.signedOutByUserId || null,
                signoutDate: io.signoutDate || null,
                projectName: project.name || 'Unknown Project'
            });
        });
    });

    allSignouts.sort((a, b) => new Date(b.signoutDate || 0) - new Date(a.signoutDate || 0));

    const itemTokens = [
        String(item.name || '').toLowerCase(),
        String(item.sku || '').toLowerCase(),
        String(item.id || '').toLowerCase()
    ].filter(Boolean);

    const logCandidates = (activityLogs || [])
        .filter(log => /sign.?out/i.test(String(log.action || '')))
        .map(log => {
            const details = String(log.details || '').toLowerCase();
            const isMatch = itemTokens.some(token => token && details.includes(token));
            if (!isMatch) return null;
            return {
                assignedToUserId: log.userId || log.user_id || null,
                signedOutByUserId: log.userId || log.user_id || null,
                signoutDate: log.timestamp || null,
                projectName: 'Activity Log'
            };
        })
        .filter(Boolean);

    allSignouts.push(...logCandidates);
    allSignouts.sort((a, b) => new Date(b.signoutDate || 0) - new Date(a.signoutDate || 0));

    const recent = [];
    const seen = new Set();
    for (const entry of allSignouts) {
        const uid = entry.assignedToUserId || entry.signedOutByUserId;
        if (!uid || seen.has(uid)) continue;

        const user = mockUsers.find(u => u.id === uid);
        recent.push({
            userId: uid,
            userName: user?.name || uid,
            projectName: entry.projectName,
            signoutDate: entry.signoutDate
        });
        seen.add(uid);
        if (recent.length >= limit) break;
    }

    return recent;
}

function buildExternalItemLink(url, label) {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl || !isSafeHttpUrl(cleanUrl)) return '<span class="text-muted">Not set</span>';
    return `<a href="${escapeHtml(cleanUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function openItemPreviewModal(itemId) {
    const item = inventoryItems.find(i => i.id === itemId);
    if (!item) return;

    const location = item.location || item.storageLocation || 'Unassigned';
    const imageLink = String(item.image_link || item.imageLink || '').trim();
    const supplierLink = String(item.supplier_listing_link || item.supplierListingLink || '').trim();
    const recentUsers = getItemRecentUsers(item, 6);

    const recentUsersHtml = recentUsers.length > 0
        ? `<ul class="activity-list mini">${recentUsers.map(entry => `
            <li>
                <strong>${escapeHtml(entry.userName)}</strong>
                <span class="text-muted">${entry.projectName} • ${entry.signoutDate ? new Date(entry.signoutDate).toLocaleString() : 'Unknown time'}</span>
            </li>
        `).join('')}</ul>`
        : '<p class="text-muted">No recent user history available yet.</p>';

    const html = `
        <div class="modal-header">
            <h3>Item Preview: ${escapeHtml(item.name)}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            ${imageLink ? `
                <div class="glass-panel" style="padding:0.75rem;margin-bottom:1rem;text-align:center;">
                    <img src="${escapeHtml(imageLink)}" alt="${escapeHtml(item.name)}" style="max-width:100%;max-height:180px;object-fit:contain;border-radius:8px;" onerror="this.parentElement.innerHTML='<p class=&quot;text-muted&quot;>Image failed to load.</p>'">
                </div>
            ` : ''}
            <div class="grid-2-col" style="gap:1rem;">
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">SKU</div>
                    <div class="font-mono" style="margin-top:0.2rem;">${escapeHtml(item.sku || 'N/A')}</div>
                </div>
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">Storage Location</div>
                    <div style="margin-top:0.2rem;">${escapeHtml(location)}</div>
                </div>
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">Supplier</div>
                    <div style="margin-top:0.2rem;">${escapeHtml(item.supplier || 'Unspecified')}</div>
                </div>
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">Supplier Product Link</div>
                    <div style="margin-top:0.2rem;">${buildExternalItemLink(supplierLink, 'Open Listing')}</div>
                </div>
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">Image Link</div>
                    <div style="margin-top:0.2rem;">${buildExternalItemLink(imageLink, 'Open Image')}</div>
                </div>
                <div class="glass-panel" style="padding:0.85rem;">
                    <div class="text-sm text-muted">Stock</div>
                    <div style="margin-top:0.2rem;">${escapeHtml(String(item.stock ?? 0))}</div>
                </div>
            </div>
            <div class="form-group" style="margin-top:1rem;">
                <label>Recent Item Users</label>
                ${recentUsersHtml}
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    openModal(html);
}

function renderInventory() {
    const tbody = document.getElementById('inventory-table-body');
    const searchInput = document.getElementById('inventory-smart-search');
    const resultsMeta = document.getElementById('inventory-results-meta');

    if (searchInput) inventorySmartSearchTerm = String(searchInput.value || '').trim().toLowerCase();

    let filtered = currentUser.role === 'student'
        ? inventoryItems.filter(item => canUserSeeItem(currentUser, item))
        : inventoryItems;

    if (inventorySmartSearchTerm) {
        filtered = filtered.filter(i => {
            const name = String(i.name || '').toLowerCase();
            const sku = String(i.sku || '').toLowerCase();
            const category = String(i.category || 'Uncategorized').toLowerCase();
            const supplier = String(i.supplier || 'Unspecified').toLowerCase();
            const brand = String(i.brand || 'Unspecified').toLowerCase();
            return name.includes(inventorySmartSearchTerm)
                || sku.includes(inventorySmartSearchTerm)
                || category.includes(inventorySmartSearchTerm)
                || supplier.includes(inventorySmartSearchTerm)
                || brand.includes(inventorySmartSearchTerm);
        });
    }

    if (resultsMeta) {
        resultsMeta.textContent = filtered.length === 0
            ? 'No matching items found. Adjust your search.'
            : `Showing ${filtered.length} item${filtered.length === 1 ? '' : 's'}.`;
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No items match your current search.</td></tr>';
        updateInventoryBulkSelectionState();
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const currentStatus = determineStatus(item.stock, item.threshold, item.item_type);
        const statusClass = currentStatus === 'In Stock' ? 'status-instock' : (currentStatus === 'Low Stock' || currentStatus === 'Out of Stock') ? 'status-lowstock' : 'status-na';
        const categoryLabel = escapeHtml(String(item.category || 'Uncategorized'));
        const brandLabel = escapeHtml(String(item.brand || 'Unspecified'));
        const safeItemId = escapeHtml(String(item.id || ''));
        const safeItemName = escapeHtml(String(item.name || 'Unnamed Item'));
        const safeItemSku = escapeHtml(String(item.sku || ''));
        const tagsHtml = (item.visibilityTags || []).map(tag =>
            `<span class="visibility-tag">${escapeHtml(String(tag || ''))}</span>`
        ).join('');

        return `
            <tr>
                <td><input type="checkbox" class="item-select-cb" data-id="${safeItemId}"></td>
                <td>
                    <div class="font-bold">
                        ${currentUser.role !== 'student'
                            ? `<button class="item-preview-btn" data-id="${safeItemId}" title="View Item Preview" style="background:none;border:none;color:inherit;padding:0;text-align:left;font:inherit;cursor:pointer;">${safeItemName}</button>`
                            : safeItemName}
                        ${renderMissingMetadataIcon(item)}
                    </div>
                    ${item.sku ? `<small class="text-xs text-muted">SKU: ${safeItemSku}</small>` : ''}
                    ${currentUser.role === 'student' && tagsHtml ? `<div class="visibility-tags-row">${tagsHtml}</div>` : ''}
                </td>
                <td>${categoryLabel}<br><small class="text-muted">${brandLabel}</small></td>
                <td class="text-muted font-mono" style="font-size:0.8rem">${safeItemSku}</td>
                <td class="inventory-stock-status-cell">
                    <div class="inventory-stock-status-content">
                        <span class="inventory-stock-value">${Math.max(0, parseInt(item?.stock, 10) || 0)} of ${getItemTotalQuantity(item)}</span>
                        <span class="status-badge ${statusClass}">${currentStatus}</span>
                    </div>
                </td>
                <td>
                    <div class="flex inventory-item-actions" style="gap:0.65rem;flex-wrap:nowrap;">
                        ${currentUser.role !== 'student' ? `
                            <button class="btn btn-secondary btn-sm inventory-item-action-btn edit-item-btn" data-id="${safeItemId}" title="Edit Item">
                                <i class="ph ph-pencil-simple"></i>
                            </button>` : ''}
                        <button class="btn btn-secondary btn-sm inventory-item-action-btn add-basket-btn" data-id="${safeItemId}" title="Add to Basket" 
                            style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2)">
                            <i class="ph ph-shopping-cart-simple"></i>
                        </button>
                        <button class="btn btn-primary btn-sm inventory-item-action-btn signout-btn" data-id="${safeItemId}" title="Sign out to Project">
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
        updateInventoryBulkSelectionState();
    });

    document.querySelectorAll('.item-select-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            syncInventorySelectAllState();
            updateInventoryBulkSelectionState();
        });
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

    document.querySelectorAll('.item-preview-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openItemPreviewModal(id);
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
                renderInventory();
            }
        });
    });

    syncInventorySelectAllState();
    updateInventoryBulkSelectionState();
}

function getSelectedInventoryItemIds() {
    return Array.from(document.querySelectorAll('.item-select-cb:checked'))
        .map(cb => String(cb.getAttribute('data-id') || '').trim())
        .filter(Boolean);
}

function syncInventorySelectAllState() {
    const selectAll = document.getElementById('select-all-items');
    if (!selectAll) return;

    const itemCbs = Array.from(document.querySelectorAll('.item-select-cb'));
    if (itemCbs.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
        return;
    }

    const checkedCount = itemCbs.filter(cb => cb.checked).length;
    selectAll.checked = checkedCount > 0 && checkedCount === itemCbs.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < itemCbs.length;
}

function updateInventoryBulkSelectionState() {
    const bulkBtn = document.getElementById('bulk-manage-items-btn');
    if (!bulkBtn) return;

    const selectedCount = getSelectedInventoryItemIds().length;
    const label = selectedCount > 0
        ? `Bulk Tags/Categories (${selectedCount})`
        : 'Bulk Tags/Categories';

    bulkBtn.innerHTML = `<i class="ph ph-stack"></i> ${label}`;
}

function runInventorySearchAction() {
    renderInventory();
}

function scheduleInventoryRender() {
    if (inventorySearchDebounceTimer) {
        clearTimeout(inventorySearchDebounceTimer);
    }

    inventorySearchDebounceTimer = setTimeout(() => {
        renderInventory();
    }, 180);
}

function getItemOutQuantity(itemId) {
    const normalizedItemId = String(itemId || '');
    return projects.reduce((total, project) => {
        const outItems = Array.isArray(project?.itemsOut) ? project.itemsOut : [];
        const qtyForItem = outItems
            .filter(entry => String(entry.itemId || '') === normalizedItemId)
            .reduce((sum, entry) => sum + (parseInt(entry.quantity, 10) || 0), 0);

        return total + qtyForItem;
    }, 0);
}

function getItemTotalQuantity(item) {
    const currentStock = parseInt(item?.stock, 10) || 0;
    const outQty = getItemOutQuantity(item?.id);
    return Math.max(0, currentStock + outQty);
}

document.getElementById('inventory-smart-search')?.addEventListener('input', () => {
    scheduleInventoryRender();
});

document.getElementById('inventory-smart-search')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runInventorySearchAction();
});

document.getElementById('request-item-btn')?.addEventListener('click', () => {
    openOrderRequestModal({
        initialName: document.getElementById('inventory-smart-search')?.value || ''
    });
});

document.getElementById('bulk-manage-items-btn')?.addEventListener('click', async () => {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to bulk manage items.', 'error');
        return;
    }

    const selectedIds = getSelectedInventoryItemIds();
    if (selectedIds.length === 0) {
        showToast('Select at least one inventory item using the checkboxes first.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('bulk managing inventory categories and visibility tags');
    if (!authOk) return;

    const categoryOptions = [
        '<option value="__KEEP__">Keep existing categories</option>',
        ...(categories.length > 0
            ? categories.map(c => `<option value="${c}">${c}</option>`)
            : ['<option value="Uncategorized">Uncategorized</option>'])
    ].join('');

    const tagOptions = visibilityTags.length > 0
        ? visibilityTags.map(tag => `
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem;">
                <input type="checkbox" class="bulk-item-tag-cb" value="${tag}"> ${tag}
            </label>
        `).join('')
        : '<p class="text-muted text-sm">No visibility tags defined. Use Visibility Tags to create some first.</p>';

    const html = `
        <div class="modal-header">
            <h3>Bulk Apply Tags/Categories</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Applying changes to <strong>${selectedIds.length}</strong> selected item(s).</p>
            <div class="form-group">
                <label>Category</label>
                <select id="bulk-item-category" class="form-control">
                    ${categoryOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Visibility Tags</label>
                <select id="bulk-tag-mode" class="form-control" style="margin-bottom:0.6rem;">
                    <option value="keep">Keep existing tags</option>
                    <option value="add">Add selected tags</option>
                    <option value="replace">Replace with selected tags</option>
                    <option value="remove">Remove selected tags</option>
                </select>
                <div class="glass-panel" style="padding:0.75rem;max-height:220px;overflow:auto;">
                    ${tagOptions}
                </div>
            </div>
            <small class="text-muted">Tip: choose "Replace" with no tags selected to clear all tags from selected items.</small>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-bulk-item-apply">Apply Changes</button>
        </div>
    `;

    openModal(html);

    const confirmBtn = document.getElementById('confirm-bulk-item-apply');
    confirmBtn?.addEventListener('click', () => {
        withButtonPending(confirmBtn, 'Applying...', async () => {
            const categoryValue = document.getElementById('bulk-item-category')?.value || '__KEEP__';
            const tagMode = document.getElementById('bulk-tag-mode')?.value || 'keep';
            const selectedTags = Array.from(document.querySelectorAll('.bulk-item-tag-cb:checked')).map(cb => cb.value);

            const shouldUpdateCategory = categoryValue !== '__KEEP__';
            const shouldUpdateTags = tagMode !== 'keep';

            if (!shouldUpdateCategory && !shouldUpdateTags) {
                showToast('Choose at least one category or tag operation before applying.', 'error');
                return;
            }

            let categoryUpdatedCount = 0;
            let categoryFailedCount = 0;
            let tagsUpdatedCount = 0;
            let tagsFailedCount = 0;

            for (const itemId of selectedIds) {
                const item = inventoryItems.find(i => i.id === itemId);
                if (!item) continue;

                if (shouldUpdateCategory) {
                    const categoryResult = await updateItemInSupabase(itemId, { category: categoryValue });
                    if (categoryResult) categoryUpdatedCount++;
                    else categoryFailedCount++;
                }

                if (shouldUpdateTags) {
                    const existingTags = Array.isArray(item.visibilityTags) ? item.visibilityTags : [];
                    let nextTags = existingTags;

                    if (tagMode === 'replace') {
                        nextTags = [...selectedTags];
                    } else if (tagMode === 'add') {
                        nextTags = Array.from(new Set([...existingTags, ...selectedTags]));
                    } else if (tagMode === 'remove') {
                        const removeSet = new Set(selectedTags);
                        nextTags = existingTags.filter(tag => !removeSet.has(tag));
                    }

                    const tagsUpdated = await setItemVisibilityTagsInSupabase(itemId, nextTags);
                    if (tagsUpdated) tagsUpdatedCount++;
                    else tagsFailedCount++;
                }
            }

            await refreshInventoryFromSupabase();
            closeModal();
            renderInventory();

            const updates = [];
            if (shouldUpdateCategory) updates.push(`category updated on ${categoryUpdatedCount}`);
            if (shouldUpdateTags) updates.push(`tags updated on ${tagsUpdatedCount}`);

            const failures = categoryFailedCount + tagsFailedCount;
            const failureText = failures > 0
                ? ` (${failures} update${failures === 1 ? '' : 's'} failed)`
                : '';

            showToast(`Bulk apply complete: ${updates.join(', ')} item(s)${failureText}.`, failures > 0 ? 'warning' : 'success');
            addLog(currentUser.id, 'Bulk Item Update', `Bulk-applied category/tags to ${selectedIds.length} inventory items.`);
        });
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

function canCurrentUserDeleteProject(project) {
    if (!currentUser || !project) return false;
    const role = String(currentUser.role || '').toLowerCase();
    if (!['teacher', 'developer'].includes(role)) return false;
    return !String(project.id || '').startsWith('PERS-');
}

function getProjectOwnerCandidates() {
    return mockUsers.filter(u => ['student', 'teacher', 'developer'].includes(u.role) && u.status !== 'Suspended');
}

function buildProjectCollaboratorOptions({ selectedOwnerId = '', selectedCollaborators = [] } = {}) {
    const selectedSet = new Set(selectedCollaborators || []);
    return getProjectOwnerCandidates()
        .filter(user => user.id !== selectedOwnerId)
        .map(user => `
            <div style="margin-bottom:0.5rem">
                <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                    <input type="checkbox" value="${user.id}" class="proj-student-checkbox" ${selectedSet.has(user.id) ? 'checked' : ''}>
                    ${user.name} (${user.id})
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
            const signedOutByUser = mockUsers.find(u => u.id === io.signedOutByUserId);
            const due = io.dueDate ? new Date(io.dueDate) : null;
            const isDueNow = due ? due <= new Date() : false;
            return `
                <li class="stock-item dashboard-project-summary" style="border-left-width:3px;">
                    <div>
                        <strong>${item ? item.name : io.itemId} (x${io.quantity})</strong>
                        <small class="text-muted block">Assigned: ${assignedUser ? assignedUser.name : assignedUserId}</small>
                        ${signedOutByUser ? `<small class="text-muted block">Signed Out By: ${signedOutByUser.name}</small>` : ''}
                        <small class="text-muted block">SKU: ${item ? item.sku : 'N/A'}</small>
                    </div>
                    <span class="${isDueNow ? 'text-danger' : 'text-warning'} font-bold text-sm">
                        ${due ? (isDueNow ? 'Due now' : `Due: ${due.toLocaleDateString()}`) : 'No due date'}
                    </span>
                </li>
            `;
        }).join('');
    const canManageProject = canCurrentUserManageProject(project);

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
            ${canManageProject ? `
            <button class="btn btn-primary" id="edit-project-from-details-btn" data-project-id="${project.id}">
                <i class="ph ph-pencil-simple"></i> Edit Project
            </button>` : ''}
        </div>
    `;

    openModal(html);
    document.getElementById('edit-project-from-details-btn')?.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-project-id');
        closeModal();
        openEditProjectModal(id);
    });
}

function getDeleteProjectMoveTargets(sourceProjectId) {
    return (projects || []).filter(project => {
        if (!project || project.id === sourceProjectId) return false;
        if (String(project.id || '').startsWith('PERS-')) return false;
        return canCurrentUserViewProject(project);
    });
}

async function performProjectDeleteWithReturnAll(project) {
    const itemsToReturn = Array.isArray(project.itemsOut) ? [...project.itemsOut] : [];

    for (const io of itemsToReturn) {
        const signoutId = io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`;
        const returned = await returnProjectItem(project.id, signoutId, {
            skipConfirmPrompt: true,
            suppressFlag: true,
            suppressToast: true
        });
        if (!returned) {
            showToast('Failed to sign in one or more items. Project was not deleted.', 'error');
            return false;
        }
    }

    return true;
}

async function performProjectDeleteWithMove(project, targetProjectId) {
    const target = projects.find(p => p.id === targetProjectId);
    if (!target) {
        showToast('Please choose a valid target project.', 'error');
        return false;
    }

    const itemsToMove = Array.isArray(project.itemsOut) ? [...project.itemsOut] : [];
    for (const io of itemsToMove) {
        const moved = await moveProjectItemOutToProjectInSupabase({
            projectItemOutId: io.id || null,
            fromProjectId: project.id,
            toProjectId: targetProjectId,
            itemId: io.itemId,
            quantity: io.quantity,
            signoutDate: io.signoutDate,
            dueDate: io.dueDate,
            assignedToUserId: io.assignedToUserId || project.ownerId,
            signedOutByUserId: io.signedOutByUserId || null
        });
        if (!moved) {
            showToast('Failed to move one or more assigned items. Project was not deleted.', 'error');
            return false;
        }
    }

    addLog(currentUser.id, 'Move Project Items', `Moved ${itemsToMove.length} assigned item row(s) from ${project.name} to ${target.name} before delete.`);
    return true;
}

async function deleteProjectAfterResolution(project, actionLabel) {
    const deleted = await deleteProjectFromSupabase(project.id);
    if (!deleted) {
        showToast('Failed to delete project in database.', 'error');
        return false;
    }

    await Promise.all([
        refreshProjectsFromSupabase(),
        refreshInventoryFromSupabase()
    ]);

    renderProjects();
    loadDashboard();
    addLog(currentUser.id, 'Delete Project', `${project.name} deleted (${actionLabel}).`);
    showToast(`Project deleted (${actionLabel}).`, 'success');
    closeModal();
    return true;
}

function openDeleteProjectModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) {
        showToast('Project not found.', 'error');
        return;
    }

    if (!canCurrentUserDeleteProject(project)) {
        showToast('Only teachers and developers can delete projects.', 'error');
        return;
    }

    const assignedRows = Array.isArray(project.itemsOut) ? project.itemsOut.length : 0;
    const assignedQty = (project.itemsOut || []).reduce((total, io) => total + (parseInt(io.quantity, 10) || 0), 0);
    const moveTargets = getDeleteProjectMoveTargets(project.id);
    const moveOptionsHtml = moveTargets.map(target => `<option value="${target.id}">${target.name}</option>`).join('');

    const hasAssignedItems = assignedRows > 0;
    const html = `
        <div class="modal-header">
            <h3>Delete Project: ${project.name}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            ${hasAssignedItems ? `
                <div class="glass-panel" style="padding:1rem;border:1px solid rgba(245,158,11,0.45);background:rgba(245,158,11,0.12);margin-bottom:1rem;">
                    <strong class="text-warning">Warning:</strong>
                    <div class="text-sm" style="margin-top:0.5rem;">
                        This project has <strong>${assignedRows}</strong> signed-out row(s) totaling <strong>${assignedQty}</strong> item(s).
                        Choose what to do with assigned items before deleting.
                    </div>
                </div>
                <div class="form-group">
                    <label>Move assigned items to another project</label>
                    <select id="delete-project-move-target" class="form-control">
                        <option value="">Select target project...</option>
                        ${moveOptionsHtml}
                    </select>
                </div>
            ` : `
                <p class="text-secondary">
                    This project has no assigned items and can be deleted immediately.
                </p>
            `}
        </div>
        <div class="modal-footer" style="display:flex;gap:0.65rem;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            ${hasAssignedItems ? `
                <button class="btn btn-secondary" id="delete-project-return-btn" data-project-id="${project.id}">
                    <i class="ph ph-arrow-counter-clockwise"></i> Sign In All Then Delete
                </button>
                <button class="btn btn-primary" id="delete-project-move-btn" data-project-id="${project.id}">
                    <i class="ph ph-arrow-bend-up-right"></i> Move Items Then Delete
                </button>
            ` : `
                <button class="btn btn-danger" id="delete-project-confirm-btn" data-project-id="${project.id}">
                    <i class="ph ph-trash"></i> Delete Project
                </button>
            `}
        </div>
    `;

    openModal(html);

    document.getElementById('delete-project-confirm-btn')?.addEventListener('click', async () => {
        await deleteProjectAfterResolution(project, 'no assigned items');
    });

    document.getElementById('delete-project-return-btn')?.addEventListener('click', async () => {
        const resolved = await performProjectDeleteWithReturnAll(project);
        if (!resolved) return;
        await deleteProjectAfterResolution(project, 'items signed in');
    });

    document.getElementById('delete-project-move-btn')?.addEventListener('click', async () => {
        const targetProjectId = document.getElementById('delete-project-move-target')?.value || '';
        if (!targetProjectId) {
            showToast('Select a target project first.', 'error');
            return;
        }

        const resolved = await performProjectDeleteWithMove(project, targetProjectId);
        if (!resolved) return;
        await deleteProjectAfterResolution(project, `items moved to ${targetProjectId}`);
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
    const target = String(signoutId ?? '').trim();
    if (!target) return -1;

    return project.itemsOut.findIndex(io => {
        const ioId = String(io.id ?? '').trim();
        if (ioId && ioId === target) return true;

        const composite = `${io.itemId}-${io.signoutDate}-${io.quantity}`;
        return composite === target;
    });
}

function doesUserBelongToProject(userId, project) {
    if (!userId || !project) return false;
    if (project.ownerId === userId) return true;
    return (project.collaborators || []).includes(userId);
}

function shouldFlagReturnOnBehalf({ project, actorUserId, assignedUserId }) {
    if (!project || !actorUserId || !assignedUserId) return false;
    if (actorUserId === assignedUserId) return false;

    const isPersonalProject = String(project.id || '').startsWith('PERS-');
    if (isPersonalProject) return true;

    const actorBelongs = doesUserBelongToProject(actorUserId, project);
    const assignedBelongs = doesUserBelongToProject(assignedUserId, project);
    if (actorBelongs && assignedBelongs) return false;

    return true;
}

async function signOutItemToPersonalProjectForUser(item, quantity, userId) {
    const targetUser = mockUsers.find(u => u.id === userId);
    if (!targetUser) return false;

    const personalProject = getOrCreatePersonalProject(userId);
    const ensured = await ensureProjectExistsInSupabase(personalProject);
    if (!ensured) return false;

    const nextStock = item.stock - quantity;
    const stockUpdated = await updateItemInSupabase(item.id, { stock: nextStock });
    if (!stockUpdated) return false;

    const signoutData = {
        id: generateId('OUT'),
        itemId: item.id,
        quantity,
        signoutDate: new Date().toISOString(),
        dueDate: calculateDueDate(new Date(), targetUser, personalProject),
        assignedToUserId: userId,
        signedOutByUserId: currentUser?.id || userId
    };

    personalProject.itemsOut.push(signoutData);

    const savedSignout = await addProjectItemOutToSupabase({
        projectId: personalProject.id,
        itemId: item.id,
        quantity,
        signoutDate: signoutData.signoutDate,
        dueDate: signoutData.dueDate,
        assignedToUserId: signoutData.assignedToUserId,
        signedOutByUserId: signoutData.signedOutByUserId
    });

    if (savedSignout?.id) signoutData.id = savedSignout.id;

    _trackItemSignout(item, quantity);
    return true;
}

function findOpenSignoutRecordsByItemCode(scanCode) {
    const normalized = String(scanCode || '').trim().toUpperCase();
    if (!normalized) return [];

    const item = inventoryItems.find(i => {
        const idMatch = String(i.id || '').trim().toUpperCase() === normalized;
        const skuMatch = String(i.sku || '').trim().toUpperCase() === normalized;
        return idMatch || skuMatch;
    });

    if (!item) return [];

    const matches = [];
    projects.forEach(project => {
        project.itemsOut.forEach(io => {
            if (io.itemId !== item.id) return;
            matches.push({ project, io, item });
        });
    });

    return matches;
}

function normalizeUserIdToken(value) {
    return String(value || '').trim().toUpperCase();
}

function getMatchAssignedUserId(match) {
    if (!match || !match.io || !match.project) return '';
    return normalizeUserIdToken(match.io.assignedToUserId || match.project.ownerId);
}

function splitMatchesForCurrentUser(matches) {
    const currentUserId = normalizeUserIdToken(currentUser?.id);
    const mine = [];
    const others = [];

    (matches || []).forEach(match => {
        if (getMatchAssignedUserId(match) === currentUserId) mine.push(match);
        else others.push(match);
    });

    return { mine, others };
}

function isGroupReturnExceptionForMatch(match) {
    if (!match || !match.project || !currentUser) return false;
    const actorId = normalizeUserIdToken(currentUser.id);
    const assignedId = getMatchAssignedUserId(match);
    if (!actorId || !assignedId) return false;
    if (String(match.project.id || '').startsWith('PERS-')) return false;
    return doesUserBelongToProject(actorId, match.project) && doesUserBelongToProject(assignedId, match.project);
}

function canCurrentUserSelectScannedMatch(match) {
    if (!currentUser || !match) return false;
    if (currentUser.role !== 'student') return true;

    const actorId = normalizeUserIdToken(currentUser.id);
    const assignedId = getMatchAssignedUserId(match);
    if (actorId && assignedId && actorId === assignedId) return true;

    // Student exception: allow on-behalf selection only within the same project group.
    return isGroupReturnExceptionForMatch(match);
}

function getPreferredScannedSignout(matches) {
    if (!Array.isArray(matches) || matches.length === 0) return null;

    const scored = matches.map(match => {
        const assignedToUserId = match.io.assignedToUserId || match.project.ownerId;
        const score =
            (assignedToUserId === currentUser?.id ? 100 : 0) +
            (doesUserBelongToProject(currentUser?.id, match.project) ? 50 : 0) +
            (String(match.project.id || '').startsWith('PERS-') ? 5 : 0);
        return { ...match, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0];
}

function buildScannedItemImageHtml(item) {
    const src = String(item?.image_link || item?.imageLink || '').trim();
    if (!src) {
        return '<div style="height:160px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:10px;margin-bottom:0.9rem;"><i class="ph ph-image" style="font-size:2rem;color:var(--text-muted)"></i></div>';
    }

    return `<img src="${src}" alt="${item?.name || 'Item image'}" style="width:100%;max-height:220px;object-fit:contain;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);margin-bottom:0.9rem;">`;
}

function findInventoryItemByScanCode(scanCode) {
    const normalized = String(scanCode || '').trim().toUpperCase();
    if (!normalized) return null;

    return inventoryItems.find(i => {
        const idMatch = String(i.id || '').trim().toUpperCase() === normalized;
        const skuMatch = String(i.sku || '').trim().toUpperCase() === normalized;
        return idMatch || skuMatch;
    }) || null;
}

async function flagUnauthorizedScan(item, scanCode) {
    if (!currentUser || currentUser.role !== 'student') return;

    await addSystemFlagToSupabase({
        id: generateId('FLAG'),
        flag_type: 'Unauthorized Scan',
        item_id: item?.id || null,
        project_id: null,
        actor_user_id: currentUser.id,
        assigned_user_id: null,
        details: `${currentUser.name} scanned restricted item ${item?.name || scanCode} (${scanCode}).`,
        status: 'Open',
        timestamp: new Date().toISOString()
    });
    await refreshRequestsFromSupabase();
}

async function handleBasketModeScan(scanCode) {
    const item = findInventoryItemByScanCode(scanCode);
    if (!item) {
        showToast('No inventory item found for that scan.', 'error');
        return;
    }

    if (currentUser.role === 'student' && !canUserSeeItem(currentUser, item)) {
        await flagUnauthorizedScan(item, scanCode);
        showToast('That item is not visible to your class.', 'error');
        return;
    }

    addToBasket(item.id);
    if (!isBasketOpen) toggleBasket(true);
}

async function openScannedItemActionModal(match) {
    if (!canCurrentUserSelectScannedMatch(match)) {
        showToast('You can only sign in your own scanned items unless both users are in the same project group.', 'error');
        return;
    }

    const { project, io, item } = match;
    const assignedToUserId = io.assignedToUserId || project.ownerId;
    const assignedToUser = mockUsers.find(u => u.id === assignedToUserId);
    const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
    const signoutId = io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`;
    const projectLabel = String(project.id || '').startsWith('PERS-') ? 'Personal' : project.name;

    const html = `
        <div class="modal-header">
            <h3>Scanned Item</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            ${buildScannedItemImageHtml(item)}
            <div class="font-bold" style="font-size:1.05rem;">${item.name}</div>
            <div class="text-muted text-sm" style="margin-top:0.2rem;">SKU: ${item.sku || 'N/A'}</div>
            <div class="text-muted text-sm" style="margin-top:0.2rem;">Storage: ${item.location || item.storageLocation || 'Not set'}</div>
            <div class="text-muted text-sm" style="margin-top:0.2rem;">Project: ${projectLabel}</div>
            <div class="text-muted text-sm" style="margin-top:0.2rem;">Signed Out To: ${assignedName}</div>
        </div>
        <div class="modal-footer" style="justify-content:space-between;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <div style="display:flex;gap:0.6rem;">
                <button class="btn" id="scan-signin-btn" style="background:rgba(16,185,129,0.22);color:#22c55e;border:1px solid rgba(34,197,94,0.35);"><i class="ph ph-arrow-counter-clockwise"></i> Sign In</button>
                <button class="btn btn-secondary" id="scan-signin-to-me-btn" style="background:rgba(148,163,184,0.16);border-color:rgba(148,163,184,0.35);"><i class="ph ph-user-switch"></i> Sign In To Me</button>
            </div>
        </div>
    `;

    openModal(html);

    document.getElementById('scan-signin-btn')?.addEventListener('click', async () => {
        await returnProjectItem(project.id, signoutId, {
            skipConfirmPrompt: true,
            forceFlagOnBehalf: true,
            flagType: 'Scanned Return On Behalf',
            flagDetails: `${currentUser.name} scanned and signed in ${item.name} on behalf of ${assignedName}.`
        });
        closeModal();
    });

    document.getElementById('scan-signin-to-me-btn')?.addEventListener('click', async () => {
        const quantity = io.quantity;

        const returned = await returnProjectItem(project.id, signoutId, {
            skipConfirmPrompt: true,
            suppressFlag: true
        });

        if (!returned) return;

        await refreshInventoryFromSupabase();
        const refreshedItem = inventoryItems.find(i => i.id === item.id);
        if (!refreshedItem) {
            showToast('Unable to reload item after sign-in.', 'error');
            return;
        }

        const reassigned = await signOutItemToPersonalProjectForUser(refreshedItem, quantity, currentUser.id);
        if (!reassigned) {
            showToast('Signed in, but failed to reassign item to your personal project.', 'error');
            return;
        }

        const shouldFlag = currentUser.id !== assignedToUserId;

        if (shouldFlag) {
            await addSystemFlagToSupabase({
                id: generateId('FLAG'),
                flag_type: 'Reassigned On Scan',
                item_id: item.id,
                project_id: project.id,
                actor_user_id: currentUser.id,
                assigned_user_id: assignedToUserId,
                details: `${currentUser.name} reassigned ${item.name} from ${assignedName} after scanner sign-in.`,
                status: 'Open',
                timestamp: new Date().toISOString()
            });
            await refreshRequestsFromSupabase();
        }

        await Promise.all([refreshProjectsFromSupabase(), refreshInventoryFromSupabase()]);
        renderProjects();
        renderInventory();
        loadDashboard();
        addLog(currentUser.id, 'Scan Reassign', `Reassigned ${item.name} to personal project after scanner return.`);
        showToast('Item reassigned to your personal project.', 'success');
        closeModal();
    });
}

function openScannedSignoutChooserModal(matches, options = {}) {
    const list = Array.isArray(matches) ? matches : [];
    if (list.length === 0) {
        showToast('No active sign-out records to choose from.', 'error');
        return;
    }

    const title = String(options.title || 'Choose Sign-out Record');
    const subtitle = String(options.subtitle || 'Multiple active sign-outs match this scan. Select the correct record.');
    const rowsHtml = list.map((match, idx) => {
        const project = match.project;
        const io = match.io;
        const item = match.item;
        const assignedToUserId = io.assignedToUserId || project.ownerId;
        const assignedToUser = mockUsers.find(u => u.id === assignedToUserId);
        const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
        const projectLabel = String(project.id || '').startsWith('PERS-') ? 'Personal' : project.name;
        const signedOutAt = io.signoutDate ? new Date(io.signoutDate) : null;

        return `
            <li class="stock-item dashboard-project-summary" style="border-left-width:3px;">
                <div>
                    <strong>${item ? item.name : io.itemId} (x${io.quantity})</strong>
                    <small class="text-muted block">Assigned To: ${assignedName}</small>
                    <small class="text-muted block">Project: ${projectLabel}</small>
                    <small class="text-muted block">Signed Out: ${signedOutAt ? signedOutAt.toLocaleString() : 'Unknown'}</small>
                </div>
                <button class="btn btn-secondary scan-choose-match-btn" data-idx="${idx}">
                    Select
                </button>
            </li>
        `;
    }).join('');

    const html = `
        <div class="modal-header">
            <h3>${title}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
            <p class="text-muted mb-4">${subtitle}</p>
            <ul class="stock-list">${rowsHtml}</ul>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;

    openModal(html);
    document.querySelectorAll('.scan-choose-match-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const chosen = list[idx];
            if (!chosen) return;
            if (!canCurrentUserSelectScannedMatch(chosen)) {
                showToast('You are not allowed to select that sign-out record.', 'error');
                return;
            }
            await openScannedItemActionModal(chosen);
        });
    });
}

async function quickSignInScannedMatch(match) {
    if (!match || !match.project || !match.io) return false;
    const signoutId = match.io.id || `${match.io.itemId}-${match.io.signoutDate}-${match.io.quantity}`;
    return returnProjectItem(match.project.id, signoutId, {
        skipConfirmPrompt: true
    });
}

async function handleInSessionBarcodeScan(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code || !currentUser) return;

    const inventoryPageActive = document.getElementById('page-inventory')?.classList.contains('active');

    const scannedItem = findInventoryItemByScanCode(code);
    if (currentUser.role === 'student' && scannedItem && !canUserSeeItem(currentUser, scannedItem)) {
        await flagUnauthorizedScan(scannedItem, code);
        showToast('That item is not visible to your class.', 'error');
        return;
    }

    if (code === 'START SCANNING' && inventoryPageActive) {
        toggleBasket(true);
        showToast('Basket scanner mode enabled. Scan item SKUs to add them.', 'success');
        return;
    }

    if (isBasketOpen) {
        await handleBasketModeScan(code);
        return;
    }

    const matches = findOpenSignoutRecordsByItemCode(code);
    if (matches.length === 0) {
        showToast('No signed-out item found for that scan.', 'error');
        return;
    }

    const { mine, others } = splitMatchesForCurrentUser(matches);

    if (mine.length === 1) {
        await quickSignInScannedMatch(mine[0]);
        return;
    }

    if (mine.length > 1) {
        openScannedSignoutChooserModal(mine, {
            title: 'Choose Your Item',
            subtitle: 'Multiple sign-out records are assigned to you for this scan. Select the one you are returning.'
        });
        return;
    }

    const eligibleOthers = currentUser.role === 'student'
        ? others.filter(canCurrentUserSelectScannedMatch)
        : others;

    if (eligibleOthers.length === 0) {
        showToast('No eligible sign-out record found for you. Students can only return non-self items for users in the same project group.', 'error');
        return;
    }

    openScannedSignoutChooserModal(eligibleOthers, {
        title: 'Select Assigned Record',
        subtitle: currentUser.role === 'student'
            ? 'This scan is not assigned to you. You may only select users in your same project group.'
            : 'This scan is not currently assigned to you. Select the correct user/project before signing in.'
    });
}

async function returnProjectItem(projectId, signoutId, options = {}) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return false;

    const ioIndex = findSignoutIndex(project, signoutId);
    if (ioIndex < 0) {
        showToast('Could not find the selected sign-out record. Refresh and try again.', 'error');
        return false;
    }

    const io = project.itemsOut[ioIndex];
    const item = inventoryItems.find(i => i.id === io.itemId);
    const assignedToUserId = io.assignedToUserId || project.ownerId;
    const assignedToUser = mockUsers.find(u => u.id === assignedToUserId);
    const returnQty = Math.max(0, parseInt(io.quantity, 10) || 0);

    if (returnQty <= 0) {
        showToast('Invalid sign-in quantity on this record.', 'error');
        return false;
    }

    if (!options.skipConfirmPrompt && currentUser.role === 'student' && currentUser.id !== assignedToUserId) {
        const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
        const confirmOnBehalf = confirm(`This item is assigned to ${assignedName}. Sign it back in on their behalf?`);
        if (!confirmOnBehalf) return false;
    }

    if (currentUser?.role === 'student') {
        const unlocked = await requestDoorUnlockAndLogAccess({
            actionType: 'sign-in',
            item,
            quantity: returnQty,
            projectName: project.name
        });

        if (!unlocked) {
            showToast('Door unlock denied. Return canceled.', 'error');
            return false;
        }
    }

    if (item) {
        const currentStock = Math.max(0, parseInt(item.stock, 10) || 0);
        const nextStock = currentStock + returnQty;
        const stockUpdated = await updateItemInSupabase(item.id, { stock: nextStock });
        if (!stockUpdated) {
            showToast('Failed to update item stock in database.', 'error');
            return false;
        }

        // Keep local state in sync immediately, even if a subsequent refresh is delayed.
        item.stock = nextStock;
    }

    if (io.id) {
        const returned = await returnItemToSupabase(io.id);
        if (!returned) {
            showToast('Failed to return item in database.', 'error');
            return false;
        }
    } else {
        const returned = await returnItemByCompositeToSupabase({
            projectId: project.id,
            itemId: io.itemId,
            signoutDate: io.signoutDate,
            quantity: io.quantity
        });
        if (!returned) {
            showToast('Failed to return item in database.', 'error');
            return false;
        }
    }

    // Remove local sign-out row immediately so My Items reflects the return without waiting on reload.
    project.itemsOut.splice(ioIndex, 1);

    try {
        await Promise.all([
            refreshProjectsFromSupabase(),
            refreshInventoryFromSupabase()
        ]);
    } catch (refreshError) {
        console.warn('Post-sign-in refresh failed:', refreshError);
    }

    if (currentUser.id !== assignedToUserId) {
        const assignedName = assignedToUser ? assignedToUser.name : assignedToUserId;
        addLog(currentUser.id, 'Return On Behalf', `Returned ${returnQty}x ${item ? item.name : io.itemId} for ${assignedName} in ${project.name}`);
        if (!options.suppressToast) {
            showToast(`Returned on behalf of ${assignedName}.`, 'warning');
        }

        const shouldFlag = !options.suppressFlag && (
            options.forceFlagOnBehalf === true ||
            shouldFlagReturnOnBehalf({
                project,
                actorUserId: currentUser.id,
                assignedUserId: assignedToUserId
            })
        );

        if (shouldFlag) {
            await addSystemFlagToSupabase({
                id: generateId('FLAG'),
                flag_type: options.flagType || 'Improper Return',
                item_id: io.itemId,
                project_id: project.id,
                actor_user_id: currentUser.id,
                assigned_user_id: assignedToUserId,
                details: options.flagDetails || `${currentUser.name} signed in ${item ? item.name : io.itemId} on behalf of ${assignedName}.`,
                status: 'Open',
                timestamp: new Date().toISOString()
            });
            await refreshRequestsFromSupabase();
        }
    } else {
        addLog(currentUser.id, 'Return Item', `Returned ${returnQty}x ${item ? item.name : io.itemId} in ${project.name}`);
        if (!options.suppressToast) {
            showToast('Item signed back in.', 'success');
        }
    }

    renderProjects();
    renderInventory();
    loadDashboard();

    return true;
}

function renderProjects() {
    const container = document.getElementById('projects-container');
    if (!container) return; // Only render if on Projects page

    // Filter projects based on role
    // Students see only projects they own or collaborate on (active or past)
    // Teachers/Devs see ALL projects (past and active)
    let visibleProjects = projects;
    if (currentUser.role === 'student') {
        visibleProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
    } else {
        visibleProjects = projects.filter(p => {
            if (!String(p.id || '').startsWith('PERS-')) return true;
            return p.ownerId === currentUser.id;
        });
    }

    const ensuredPersonalProject = getOrCreatePersonalProject(currentUser.id);
    if (!visibleProjects.some(p => p.id === ensuredPersonalProject.id)) {
        visibleProjects = [ensuredPersonalProject, ...visibleProjects];
    }

    // Separate personal projects for display in a dedicated section
    const personalProjectId = `PERS-${currentUser.id}`;
    const personalProject = visibleProjects.find(p => p.id === personalProjectId);
    const nonPersonalProjects = visibleProjects.filter(p => p.id !== personalProjectId);

    let html = '';

    // Add My Items personal project section first for every user.
    if (personalProject) {
        const personalItemsHtml = personalProject.itemsOut.length > 0 ? personalProject.itemsOut.map(io => {
            const item = inventoryItems.find(i => i.id === io.itemId);
            const signoutId = io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`;
            return `
                <div class="flex justify-between items-center text-sm" style="gap:0.75rem;">
                    <div>
                        <span>${io.quantity}x <strong>${escapeHtml(item ? item.name : 'Unknown')}</strong></span>
                        <div class="text-xs text-muted">Signed Out: ${new Date(io.signoutDate).toLocaleDateString()}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span class="text-muted font-mono" style="font-size:0.75rem">${escapeHtml(item ? item.sku : 'N/A')}</span>
                        <button class="btn btn-secondary text-sm return-project-item-btn" data-project-id="${escapeHtml(personalProject.id)}" data-signout-id="${escapeHtml(signoutId)}" style="padding:0.2rem 0.5rem;font-size:0.75rem;"><i class="ph ph-arrow-counter-clockwise"></i> Sign In</button>
                    </div>
                </div>
            `;
        }).join('') : '<p class="text-muted text-sm">No items currently signed out to your personal project.</p>';

        html += `
            <div class="project-card glass-panel flex-col" style="border-left:4px solid var(--accent);">
                <div class="project-header">
                    <h4 style="color:var(--accent);"><i class="ph ph-backpack"></i> My Items</h4>
                </div>
                <div style="display:flex; flex-direction:column; gap:0.5rem;">
                    ${personalItemsHtml}
                </div>
            </div>
        `;
    }

    if (nonPersonalProjects.length === 0 && html === '') {
        container.innerHTML = '<p class="text-muted col-span-full">No projects found.</p>';
        return;
    }

    container.innerHTML = html + nonPersonalProjects.map(proj => {
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
            const signedOutByUser = mockUsers.find(u => u.id === io.signedOutByUserId);
            const signoutId = io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`;
            return `
                            <div class="flex justify-between items-center text-sm" style="gap:0.75rem;">
                                <div>
                                    <span>${io.quantity}x <strong>${escapeHtml(item ? item.name : 'Unknown')}</strong></span>
                                    <div class="text-xs text-muted">Assigned: ${escapeHtml(assignedUser ? assignedUser.name : assignedUserId)}</div>
                                    ${signedOutByUser ? `<div class="text-xs text-muted">By: ${escapeHtml(signedOutByUser.name)}</div>` : ''}
                                </div>
                                <div style="display:flex;align-items:center;gap:0.5rem;">
                                    <span class="text-muted font-mono" style="font-size:0.75rem">${escapeHtml(item ? item.sku : 'N/A')}</span>
                                    ${canCurrentUserReturnProjectItem(proj) ? `<button class="btn btn-secondary text-sm return-project-item-btn" data-project-id="${escapeHtml(proj.id)}" data-signout-id="${escapeHtml(signoutId)}" style="padding:0.2rem 0.5rem;font-size:0.75rem;"><i class="ph ph-arrow-counter-clockwise"></i> Sign In</button>` : ''}
                                </div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        ` : '';

        return `
            <div class="project-card glass-panel flex-col" data-project-id="${escapeHtml(proj.id)}">
                <div class="project-header">
                    <div>
                        <h4>${escapeHtml(proj.name)}</h4>
                    </div>
                    <span class="status-badge ${getProjectStatusBadgeClass(proj.status)}">${escapeHtml(proj.status)}</span>
                </div>
                <p class="text-muted text-sm mb-2">Owner: ${escapeHtml(owner ? owner.name : 'Unknown')}</p>
                <p class="project-desc mb-4">${escapeHtml(proj.description)}</p>
                <div class="project-footer"><strong>${outCount}</strong> items signed out</div>
                ${itemsOutHtml}
                <div class="project-meta">
                    <span class="text-muted text-sm">${proj.itemsOut.length > 0 ? 'Use Sign In to return tools.' : 'No items currently signed out.'}</span>
                    <div class="project-action-buttons">
                        ${canManage ? `<button class="btn btn-secondary text-sm edit-proj-btn" data-id="${escapeHtml(proj.id)}">
                            <i class="ph ph-pencil-simple"></i> Edit
                        </button>` : ''}
                        <button class="btn btn-secondary text-sm view-proj-btn" data-id="${escapeHtml(proj.id)}">Details</button>
                    </div>
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
    const myProjects = projects.filter(p => (p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id)) && !String(p.id || '').startsWith('PERS-'));

    const personalOption = `<option value="personal">My Items (Personal)</option>`;
    const projectsOptions = personalOption + myProjects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');

    // Build assignee options based on first project (will update when project changes)
    const getAssigneeOptions = (projId) => {
        if (projId === 'personal') {
            return `<option value="${escapeHtml(currentUser.id)}">${escapeHtml(currentUser.name)}</option>`;
        }
        const proj = projects.find(p => p.id === projId);
        if (!proj) return '';
        
        let options = '';
        // Add myself option for teachers
        if (currentUser.role !== 'student') {
            options += `<option value="${escapeHtml(currentUser.id)}">Myself (${escapeHtml(currentUser.name)})</option>`;
        }
        // Add project owner if not already added
        if (currentUser.role === 'student' || proj.ownerId !== currentUser.id) {
            const owner = mockUsers.find(u => u.id === proj.ownerId);
            options += `<option value="${escapeHtml(proj.ownerId)}">${escapeHtml(owner ? owner.name : proj.ownerId)}</option>`;
        }
        // Add collaborators
        if (proj.collaborators && proj.collaborators.length > 0) {
            proj.collaborators.forEach(collab => {
                const user = mockUsers.find(u => u.id === collab);
                if (collab !== currentUser.id && collab !== proj.ownerId) {
                    options += `<option value="${escapeHtml(collab)}">${escapeHtml(user ? user.name : collab)}</option>`;
                }
            });
        }
        return options;
    };

    // Determine default assignee based on role
    const defaultAssigneeId = currentUser.role === 'student' ? projects.find(p => p.id === (myProjects[0]?.id || 'personal'))?.ownerId || currentUser.id : currentUser.id;

    // Only show "Assign To" field for teachers
    const assignToFieldHtml = currentUser.role !== 'student' ? `
        <div class="form-group">
            <label>Assign To</label>
            <select id="so-assignee" class="form-control">
                ${getAssigneeOptions(myProjects[0]?.id || 'personal')}
            </select>
        </div>
    ` : '';

    const html = `
        <div class="modal-header">
            <h3>Sign Out Item</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">You are signing out: <strong>${escapeHtml(item.name)}</strong></p>
            <div class="glass-panel" style="padding:0.85rem;margin-bottom:0.9rem;border-radius:var(--radius-sm)">
                <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;">
                    <div>
                        <div class="font-bold">${escapeHtml(item.name)}</div>
                        <small class="text-muted">SKU: ${escapeHtml(item.sku || 'N/A')} | Category: ${escapeHtml(item.category || 'N/A')}</small>
                    </div>
                    <span class="badge" style="background:rgba(245,158,11,0.2);color:var(--warning)">In Stock: ${escapeHtml(item.stock)}</span>
                </div>
                <div style="margin-top:0.45rem">
                    <small><strong>Location:</strong> ${formatItemExtraInfo(item).location}</small><br>
                    <small><strong>Description:</strong> ${formatItemExtraInfo(item).description}</small>
                </div>
                <div style="margin-top:0.45rem">
                    <small><strong>Due Date (preview):</strong> <span id="so-due-preview">${new Date(calculateDueDate(new Date(), currentUser)).toLocaleString()}</span></small>
                </div>
            </div>
            <div class="form-group">
                <label>Select Project</label>
                <select id="so-project" class="form-control">
                    ${projectsOptions}
                </select>
            </div>
            ${assignToFieldHtml}
            <div class="form-group">
                <label>Quantity (Max: ${item.stock})</label>
                <input type="number" id="so-qty" class="form-control" min="1" max="${item.stock}" value="1">
                <small class="text-muted" style="display:block;margin-top:0.35rem;"><strong>QTY:</strong> <span id="so-qty-preview">1x</span> | <strong>Stock After:</strong> <span id="so-stock-preview">${Math.max(0, item.stock - 1)}</span></small>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-signout">Confirm Sign Out</button>
        </div>
    `;

    openModal(html);

    const soQtyInput = document.getElementById('so-qty');
    const soQtyPreview = document.getElementById('so-qty-preview');
    const soStockPreview = document.getElementById('so-stock-preview');
    const refreshQtyPreview = () => {
        if (!soQtyInput) return;
        const maxQty = Math.max(1, parseInt(soQtyInput.max, 10) || item.stock || 1);
        const normalizedQty = Math.max(1, Math.min(maxQty, parseInt(soQtyInput.value, 10) || 1));
        soQtyInput.value = String(normalizedQty);
        if (soQtyPreview) soQtyPreview.textContent = `${normalizedQty}x`;
        if (soStockPreview) soStockPreview.textContent = String(Math.max(0, item.stock - normalizedQty));
    };
    soQtyInput?.addEventListener('input', refreshQtyPreview);
    refreshQtyPreview();

    // Update assignee options when project changes (for teachers)
    if (currentUser.role !== 'student') {
        document.getElementById('so-project')?.addEventListener('change', (e) => {
            const projId = e.target.value;
            const assigneeSelect = document.getElementById('so-assignee');
            if (assigneeSelect) {
                assigneeSelect.innerHTML = getAssigneeOptions(projId);
            }
            const previewEl = document.getElementById('so-due-preview');
            const selectedProject = projId === 'personal'
                ? getOrCreatePersonalProject(currentUser.id)
                : projects.find(p => p.id === projId);
            if (previewEl) previewEl.textContent = new Date(calculateDueDate(new Date(), currentUser, selectedProject)).toLocaleString();
        });
    } else {
        document.getElementById('so-project')?.addEventListener('change', (e) => {
            const projId = e.target.value;
            const previewEl = document.getElementById('so-due-preview');
            const selectedProject = projId === 'personal'
                ? getOrCreatePersonalProject(currentUser.id)
                : projects.find(p => p.id === projId);
            if (previewEl) previewEl.textContent = new Date(calculateDueDate(new Date(), currentUser, selectedProject)).toLocaleString();
        });
    }

    document.getElementById('confirm-signout').addEventListener('click', async () => {
        const projId = document.getElementById('so-project').value;
        const qty = parseInt(document.getElementById('so-qty').value);
        let assignedToUserId = null;
        
        // Get assignee from form if teacher, otherwise use project owner
        if (currentUser.role !== 'student') {
            assignedToUserId = document.getElementById('so-assignee')?.value;
        }

        if (qty > 0 && qty <= item.stock) {
            const constraintError = exceedsCheckoutConstraints({
                distinctItems: 1,
                totalQuantity: qty
            });
            if (constraintError) {
                showToast(constraintError, 'error');
                return;
            }

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
                    showToast('Failed to create personal project in database.', 'error');
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

            // For students, assign to project owner; for teachers, use selected assignee
            const finalAssignedToUserId = assignedToUserId || project.ownerId;

            const signoutData = {
                id: generateId('OUT'),
                itemId: item.id,
                quantity: qty,
                signoutDate: new Date().toISOString(),
                dueDate: calculateDueDate(new Date(), currentUser, project),
                assignedToUserId: finalAssignedToUserId,
                signedOutByUserId: currentUser.id
            };

            const savedSignout = await addProjectItemOutToSupabase({
                id: signoutData.id,
                projectId: project.id,
                itemId: item.id,
                quantity: qty,
                signoutDate: signoutData.signoutDate,
                dueDate: signoutData.dueDate,
                assignedToUserId: signoutData.assignedToUserId,
                signedOutByUserId: signoutData.signedOutByUserId
            });

            if (!savedSignout) {
                const errDetail = typeof getLastProjectItemOutError === 'function'
                    ? String(getLastProjectItemOutError() || '').slice(0, 180)
                    : '';
                showToast(`Failed to save sign-out record. ${errDetail || 'Item stock was not changed.'}`, 'error');
                return;
            }

            const nextStock = item.stock - qty;
            const stockUpdated = await updateItemInSupabase(item.id, { stock: nextStock });
            if (!stockUpdated) {
                if (savedSignout?.id) {
                    await returnItemToSupabase(savedSignout.id);
                } else {
                    await returnItemByCompositeToSupabase({
                        projectId: project.id,
                        itemId: item.id,
                        signoutDate: signoutData.signoutDate,
                        quantity: signoutData.quantity
                    });
                }
                showToast('Failed to update stock. Sign-out was rolled back.', 'error');
                return;
            }

            item.stock = nextStock;
            signoutData.id = savedSignout?.id || signoutData.id;
            project.itemsOut.push(signoutData);

            _trackItemSignout(item, qty);
            // Log activity
            addLog(currentUser.id, 'Sign Out', `Signed out ${qty}x ${item.name} (SKU: ${item.sku}) for Project: ${String(project.id || '').startsWith('PERS-') ? 'My Items (Personal)' : project.name}`);

            await Promise.all([refreshProjectsFromSupabase(), refreshInventoryFromSupabase()]);

            showToast(`Successfully signed out ${qty} items!`, 'success');
            closeModal();

            // Refresh current views
            renderInventory();
            renderProjects();
            loadDashboard();
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
            ? allowedTags.map(t => `<span class="visibility-tag">${escapeHtml(t)}</span>`).join('')
            : '<span class="text-muted text-sm">None selected</span>';
        const safeClassId = escapeHtml(String(cls.id || ''));
        const safeClassName = escapeHtml(String(cls.name || 'Untitled Class'));
        const safeTeacherName = escapeHtml(String(teacher ? teacher.name : 'Unknown'));

        return `
            <div class="project-card glass-panel" style="position:relative">
                <div style="position:absolute; top:1rem; right:1rem; display:flex; gap:0.5rem;">
                    <button class="icon-btn text-accent edit-class-btn" data-id="${safeClassId}" title="Edit Class"><i class="ph ph-pencil-simple"></i></button>
                    <button class="icon-btn text-danger delete-class-btn" data-id="${safeClassId}" title="Delete Class"><i class="ph ph-trash"></i></button>
                </div>
                <div class="project-header">
                    <h3 style="color: var(--accent-secondary)">${safeClassName}</h3>
                </div>
                <div class="text-sm mt-4"><strong>${studentCount}</strong> Students Enrolled</div>
                <div class="text-sm"><strong>Visible Items:</strong> ${visibleItemCount}</div>
                <div class="text-sm"><strong>Default Due Minutes:</strong> ${classDuePolicy.defaultSignoutMinutes}</div>
                <div class="text-sm" style="margin-top:0.4rem"><strong>Allowed Visibility Tags:</strong><br><div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.3rem">${tagsDisplay}</div></div>
                <div class="project-meta text-sm">
                    <span class="text-muted">Teacher: ${safeTeacherName}</span>
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
                    showToast('Failed to delete class from database.', 'error');
                    return;
                }
                
                // Delete students who are only in this class
                let deletedStudentCount = 0;
                if (cls.students && cls.students.length > 0) {
                    for (const studentId of cls.students) {
                        // Check if this student is in any other class
                        const otherClasses = studentClasses.filter(c => c.id !== id && c.students.includes(studentId));
                        if (otherClasses.length === 0) {
                            // Student is only in this class, delete them
                            const userDeleted = await deleteUserFromSupabase(studentId);
                            if (userDeleted) {
                                mockUsers = mockUsers.filter(u => u.id !== studentId);
                                deletedStudentCount++;
                            }
                        }
                    }
                }
                
                studentClasses = studentClasses.filter(c => c.id !== id);
                const toastMsg = deletedStudentCount > 0 
                    ? `Class ${cls.name} deleted. ${deletedStudentCount} student(s) also deleted.`
                    : `Class ${cls.name} deleted.`;
                showToast(toastMsg, 'success');
                addLog(currentUser.id, 'Delete Class', `Deleted student class: ${cls.name} (deleted ${deletedStudentCount} student(s))`);
                renderClasses();
                renderUsers();
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
    const teacherCandidates = mockUsers.filter(u => ['teacher', 'developer'].includes(u.role));
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

    const teacherFieldHtml = currentUser.role === 'developer'
        ? `
            <div class="form-group">
                <label>Class Teacher</label>
                <select id="edit-class-teacher" class="form-control">
                    <option value="">Unassigned</option>
                    ${teacherCandidates.map(t => `<option value="${t.id}" ${cls.teacherId === t.id ? 'selected' : ''}>${t.name} (${t.id})</option>`).join('')}
                </select>
                <small class="text-muted">Teacher assignment: assign or change the teacher for this class.</small>
            </div>
        `
        : '';

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
            ${teacherFieldHtml}
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
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Visibility is tag-based only. Students see items with ANY checked tag. Untagged items are hidden from students.</small>
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
                <label>Class Periods</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 36px;gap:0.5rem;margin-bottom:0.25rem">
                    <span class="text-muted" style="font-size:0.8rem">Start</span>
                    <span class="text-muted" style="font-size:0.8rem">End</span>
                    <span class="text-muted" style="font-size:0.8rem">Due Back Time</span>
                    <span></span>
                </div>
                <div id="edit-class-period-rows">${buildPeriodRowsHtml(classDuePolicy.periodRanges)}</div>
                <button type="button" id="edit-class-add-period-btn" class="btn btn-secondary" style="margin-top:0.5rem">
                    <i class="ph ph-plus"></i> Add Period
                </button>
                <small class="text-muted" style="display:block;margin-top:0.4rem">If a sign-out happens during a period range, it is due at that row's Due Back Time.</small>
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
        const timezone = document.getElementById('edit-class-timezone').value;
        const parsedRanges = collectPeriodRowsFromModal('edit-class-period-rows');
        const selectedTeacherId = currentUser.role === 'developer'
            ? (document.getElementById('edit-class-teacher')?.value || null)
            : cls.teacherId;

        if (name) {
            cls.name = name;
            cls.teacherId = selectedTeacherId;
            cls.students = checkedStudents;
            cls.visibleItemIds = [];
            cls.allowedVisibilityTags = checkedTags;
            cls.duePolicy = normalizeDuePolicy({
                defaultSignoutMinutes: defaultDueMinutes,
                timezone,
                periodRanges: parsedRanges
            });

            const saved = await saveStudentClassToSupabase(cls);
            if (!saved) {
                showToast('Failed to save class updates to database.', 'error');
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

document.getElementById('create-class-btn')?.addEventListener('click', async () => {
    const authOk = await ensurePrivilegedActionAuth('creating classes');
    if (!authOk) return;

    if (!currentUser || !['teacher', 'developer'].includes(currentUser.role)) {
        showToast('Only teachers can create classes.', 'error');
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
    const teacherCandidates = mockUsers.filter(u => ['teacher', 'developer'].includes(u.role));
    const teacherFieldHtml = currentUser.role === 'developer'
        ? `
            <div class="form-group">
                <label>Class Teacher</label>
                <select id="add-class-teacher" class="form-control">
                    <option value="">Unassigned</option>
                    ${teacherCandidates.map(t => `<option value="${t.id}" ${t.id === currentUser.id ? 'selected' : ''}>${t.name} (${t.id})</option>`).join('')}
                </select>
                <small class="text-muted">Teacher assignment: choose which teacher this class belongs to.</small>
            </div>
        `
        : '';

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
            ${teacherFieldHtml}
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
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Visibility is tag-based only. Students see items with ANY checked tag. Untagged items are hidden from students.</small>
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
                <label>Class Periods</label>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr 36px;gap:0.5rem;margin-bottom:0.25rem">
                    <span class="text-muted" style="font-size:0.8rem">Start</span>
                    <span class="text-muted" style="font-size:0.8rem">End</span>
                    <span class="text-muted" style="font-size:0.8rem">Due Back Time</span>
                    <span></span>
                </div>
                <div id="add-class-period-rows">${defaultRangesHtml}</div>
                <button type="button" id="add-class-add-period-btn" class="btn btn-secondary" style="margin-top:0.5rem">
                    <i class="ph ph-plus"></i> Add Period
                </button>
                <small class="text-muted" style="display:block;margin-top:0.4rem">If a sign-out happens during a period range, it is due at that row's Due Back Time.</small>
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
            const timezone = document.getElementById('add-class-timezone').value;
            const parsedRanges = collectPeriodRowsFromModal('add-class-period-rows');
            const selectedTeacherId = currentUser.role === 'developer'
                ? (document.getElementById('add-class-teacher')?.value || null)
                : currentUser.id;

            if (name) {
                const newClass = {
                    id: (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : generateId('CLS'),
                    name: name,
                    teacherId: selectedTeacherId,
                    students: checkedStudents,
                    visibleItemIds: [],
                    allowedVisibilityTags: checkedTags,
                    duePolicy: normalizeDuePolicy({
                        defaultSignoutMinutes: defaultDueMinutes,
                        timezone,
                        periodRanges: parsedRanges
                    }),
                    defaultPermissions: {
                        canCreateProjects: !!policyConfig.accessLevelDefaults.canCreateProjects,
                        canJoinProjects: !!policyConfig.accessLevelDefaults.canJoinProjects,
                        canSignOut: !!policyConfig.accessLevelDefaults.canSignOut
                    }
                };

                const saved = await saveStudentClassToSupabase(newClass);
                if (!saved) {
                    showToast('Failed to create class in database.', 'error');
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
    const actorFilter = document.getElementById('logs-actor-filter');
    if (!tbody) return;
    if (currentUser.role === 'student') return; // Double check protection

    if (actionFilter) {
        const previousValue = actionFilter.value || 'all';
        const actions = [...new Set(activityLogs.map(log => log.action).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));

        actionFilter.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'View All Actions';
        actionFilter.appendChild(allOption);

        actions.forEach(action => {
            const opt = document.createElement('option');
            opt.value = String(action || '');
            opt.textContent = String(action || '');
            actionFilter.appendChild(opt);
        });

        actionFilter.value = actions.includes(previousValue) || previousValue === 'all'
            ? previousValue
            : 'all';

        if (!actionFilter.dataset.bound) {
            actionFilter.addEventListener('change', () => renderLogs());
            actionFilter.dataset.bound = '1';
        }
    }

    if (actorFilter && !actorFilter.dataset.bound) {
        actorFilter.addEventListener('change', () => renderLogs());
        actorFilter.dataset.bound = '1';
    }

    const selectedAction = actionFilter?.value || 'all';
    const selectedActor = actorFilter?.value || 'all';

    let filteredLogs = selectedAction === 'all'
        ? activityLogs
        : activityLogs.filter(log => log.action === selectedAction);

    if (selectedActor !== 'all') {
        filteredLogs = filteredLogs.filter(log => {
            const idToMatch = log.userId || log.user_id;
            const logUser = mockUsers.find(u => u.id === idToMatch);
            if (!logUser) return false;
            if (selectedActor === 'student') return logUser.role === 'student';
            return logUser.role === 'teacher' || logUser.role === 'developer';
        });
    }

    tbody.innerHTML = filteredLogs.map(log => {
        const idToMatch = log.userId || log.user_id;
        const trUser = mockUsers.find(u => u.id === idToMatch);
        const rawTimestamp = log.timestamp ? new Date(log.timestamp) : null;
        const timestampLabel = rawTimestamp && !Number.isNaN(rawTimestamp.getTime())
            ? rawTimestamp.toLocaleString()
            : 'Unknown date';
        const actionLabel = escapeHtml(log.action || 'Unknown Action');
        const detailsLabel = escapeHtml(log.details || '');
        const userLabel = escapeHtml(trUser?.name || idToMatch || 'Unknown User');
        return `
            <tr>
                <td class="text-muted"><small>${timestampLabel}</small></td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span style="font-size:1.2rem">${getRoleIcon(trUser?.role)}</span>
                        ${userLabel}
                    </div>
                </td>
                <td><strong>${actionLabel}</strong></td>
                <td>${detailsLabel}</td>
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

    const getUserGradeLabel = (user) => {
        const explicit = String(user.grade || '').trim();
        if (explicit) return explicit;
        if (user.role !== 'student') return 'N/A';

        const matchedClass = studentClasses.find(cls => (cls.students || []).includes(user.id));
        if (!matchedClass) return 'N/A';

        const fromClassName = String(matchedClass.name || '').match(/grade\s*(k|\d{1,2})/i);
        return fromClassName ? fromClassName[1].toUpperCase() : 'N/A';
    };

    const searchValue = String(document.getElementById('users-search-input')?.value || '').trim().toLowerCase();
    const filteredUsers = (mockUsers || []).filter(user => {
        if (!searchValue) return true;
        const gradeLabel = getUserGradeLabel(user);
        const tokens = [
            user?.name,
            user?.id,
            user?.role,
            user?.status,
            user?.email,
            user?.username,
            gradeLabel
        ];
        const haystack = tokens.map(value => String(value || '').toLowerCase()).join(' ');
        return haystack.includes(searchValue);
    });

    tbody.innerHTML = filteredUsers.map(user => {
        const suspensionBypassed = isSuspensionBypassedUser(user);
        const isSuspended = user.status === 'Suspended' && !suspensionBypassed;
        const canEdit = !(currentUser.role === 'teacher' && user.role === 'developer') || (currentUser.id === user.id && user.role === 'developer');
        const isDeveloper = user.role === 'developer';
        const userItemsOut = getItemsOutForUser(user.id);
        const userOutQty = userItemsOut.reduce((sum, row) => sum + row.quantity, 0);
        const gradeLabel = getUserGradeLabel(user);

        const safeUserId = escapeHtml(String(user.id || ''));
        const safeUserName = escapeHtml(String(user.name || 'Unknown User'));
        const safeUserRole = escapeHtml(String(user.role || 'unknown'));
        const safeGradeLabel = escapeHtml(String(gradeLabel || 'N/A'));

        return `
            <tr class="${isSuspended ? 'opacity-60' : ''}">
                <td>
                    <input type="checkbox" class="user-select-cb" data-id="${safeUserId}">
                </td>
                <td>
                    <div class="flex items-center user-row-identity">
                        <div class="avatar-sm">${getRoleIcon(user.role)}</div>
                        <div>
                            <div class="font-bold">${safeUserName}</div>
                            <small class="text-muted">${safeUserId}</small>
                            <div class="text-xs text-muted">Items Out: ${userOutQty}</div>
                        </div>
                    </div>
                </td>
                <td>
                    <span class="text-muted">${safeGradeLabel}</span>
                </td>
                <td>
                    <div class="flex flex-col items-start gap-1">
                        <span class="badge" style="color:${user.role === 'developer' ? '#8b5cf6' : user.role === 'teacher' ? '#f59e0b' : '#94a3b8'}">
                            ${safeUserRole}
                        </span>
                        ${isSuspended ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: var(--danger); font-size: 0.7rem; border: 1px solid rgba(239,68,68,0.2)">SUSPENDED</span>` : ''}
                        ${suspensionBypassed ? `<span class="badge" style="background: rgba(16,185,129,0.18); color: var(--success); font-size: 0.7rem; border: 1px solid rgba(16,185,129,0.28)">ALWAYS ACTIVE</span>` : ''}
                    </div>
                </td>
                <td>
                    <div class="flex gap-2 user-actions">
                        ${canEdit ? `<button class="btn btn-secondary btn-sm edit-user-btn" data-id="${safeUserId}" title="Edit User"><i class="ph ph-pencil"></i></button>` : ''}
                        <button class="btn btn-secondary btn-sm view-user-items-btn" data-id="${safeUserId}" title="View Items Out"><i class="ph ph-package"></i></button>
                        ${!isDeveloper ? `<button class="btn btn-secondary btn-sm suspend-user-btn" data-id="${safeUserId}" title="${isSuspended ? 'Reactivate' : 'Suspend'}" ${suspensionBypassed ? 'disabled' : ''}>
                            <i class="ph ${isSuspended ? 'ph-user-check' : 'ph-user-minus'}"></i>
                        </button>
                        <button class="btn btn-danger btn-sm delete-user-btn" data-id="${safeUserId}" title="Delete"><i class="ph ph-trash"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (filteredUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No users match your search.</td></tr>';
        return;
    }

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
                showToast('Teachers cannot be suspended.', 'error');
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
                showToast('Failed to update user status in database.', 'error');
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

    document.querySelectorAll('.view-user-items-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            openUserItemsModal(id);
        });
    });

    document.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const user = mockUsers.find(u => u.id === id);
            if (!user) return;

            if (currentUser.role === 'teacher' && user.role === 'developer') {
                showToast('Teachers cannot delete restricted accounts.', 'error');
                return;
            }

            if (confirm(`CRITICAL: Are you sure you want to delete ${user.name}? This action is permanent.`)) {
                const deletingCurrentUser = currentUser?.id === id;
                const deleted = await deleteUserFromSupabase(id);
                if (!deleted) {
                    showToast('Failed to delete user from database.', 'error');
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

async function openUserModal(editId = null) {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to manage users.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth(editId ? 'editing users' : 'adding users');
    if (!authOk) return;

    const isEdit = !!editId;
    const userToEdit = isEdit ? mockUsers.find(u => u.id === editId) : null;
    const canEditBarcode = isEdit && (currentUser.role === 'teacher' || currentUser.role === 'developer');

    // Default student permissions
    const cProjects = isEdit ? (userToEdit.perms?.canCreateProjects ?? false) : false;
    const cJoin = isEdit ? (userToEdit.perms?.canJoinProjects ?? true) : true;
    const cSignOut = isEdit ? (userToEdit.perms?.canSignOut ?? false) : false;
    const initialGrade = isEdit ? String(userToEdit.grade || '') : '';

    const html = `
        <div class="modal-header">
            <h3>${isEdit ? 'Edit User' : 'Add New User'}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>User ID / Barcode</label>
                <input type="text" id="user-id" class="form-control" placeholder="e.g. STU-999" ${(isEdit && !canEditBarcode) ? 'disabled' : ''} value="${isEdit ? userToEdit.id : ''}">
            </div>
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" id="user-name-input" class="form-control" placeholder="Jane Doe" value="${isEdit ? userToEdit.name : ''}">
            </div>
            <div class="form-group">
                <label>Grade</label>
                <input type="text" id="user-grade-input" class="form-control" placeholder="e.g. 10, 11, 12" value="${initialGrade}">
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
            `<span class="text-danger text-sm" style="margin-right:1rem">Teacher role locked</span>` :
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
        const grade = document.getElementById('user-grade-input').value.trim();
        const role = document.getElementById('user-role-input').value;

        // Developer role restrictions
        if (role === 'developer' && currentUser.role === 'teacher') {
            showToast('Only teachers can create other teachers.', 'error');
            return;
        }

        if (role === 'developer' && currentUser.role !== 'developer') {
            showToast('Only teachers can assign the teacher role.', 'error');
            return;
        }

        // Prevent teachers from becoming developers
        if (!isEdit && role === 'developer' && currentUser.role === 'teacher') {
            showToast('Teachers cannot change to a restricted role.', 'error');
            return;
        }

        // Check if a developer already exists (only when creating new developer)
        if (!isEdit && role === 'developer') {
            const existingDev = mockUsers.find(u => u.role === 'developer');
            if (existingDev) {
                showToast('Only one teacher can exist in the system.', 'error');
                return;
            }
        }

        // Prevent changing a teacher to developer
        if (isEdit && userToEdit.role !== 'developer' && role === 'developer' && currentUser.role === 'teacher') {
            showToast('Teachers cannot change others to restricted roles.', 'error');
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
                    showToast('Only teachers can edit user barcodes.', 'error');
                    return;
                }

                if (mockUsers.some(u => u.id === id)) {
                    showToast('A user with this barcode already exists.', 'error');
                    return;
                }

                const renamed = await renameUserBarcodeInSupabase(originalId, id);
                if (!renamed) {
                    showToast('Failed to update user barcode in database.', 'error');
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
            userToEdit.grade = grade;
            userToEdit.perms = perms;

            // Update Class Alignment
            studentClasses.forEach(cls => {
                cls.students = cls.students.filter(sId => sId !== userToEdit.id); // Remove user from all classes first
                if (role === 'student' && cls.id === assignedClassId && assignedClassId !== '') {
                    cls.students.push(userToEdit.id); // Add user to the selected class
                }
            });

            // Update in Supabase
            const updated = await updateUserInSupabase(id, { name, role, grade, status: userToEdit.status });
            if (!updated) {
                showToast('Failed to update user in database.', 'error');
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
                grade: grade,
                role: role,
                perms: perms,
                status: 'Active'
            };

            const created = await addUserToSupabase(newUser);
            if (!created) {
                showToast('Failed to add user in database.', 'error');
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

function getItemsOutForUser(userId) {
    if (!userId) return [];
    const rows = [];

    projects.forEach(project => {
        project.itemsOut.forEach(io => {
            const assignedUserId = io.assignedToUserId || project.ownerId;
            if (assignedUserId !== userId) return;

            const item = inventoryItems.find(i => i.id === io.itemId);
            rows.push({
                projectId: project.id,
                projectName: project.name,
                quantity: io.quantity,
                itemId: io.itemId,
                itemName: item?.name || io.itemId,
                sku: item?.sku || 'N/A',
                dueDate: io.dueDate
            });
        });
    });

    rows.sort((a, b) => String(a.itemName).localeCompare(String(b.itemName)));
    return rows;
}

function openUserItemsModal(userId) {
    const user = mockUsers.find(u => u.id === userId);
    if (!user) return;

    const itemsOut = getItemsOutForUser(userId);
    const personalRows = itemsOut.filter(row => String(row.projectId || '').startsWith('PERS-'));
    const projectRows = itemsOut.filter(row => !String(row.projectId || '').startsWith('PERS-'));
    const projectCount = new Set(projectRows.map(row => row.projectId)).size;
    const projectItemCount = projectRows.reduce((sum, row) => sum + row.quantity, 0);
    const personalItemCount = personalRows.reduce((sum, row) => sum + row.quantity, 0);
    const totalItemCount = projectItemCount + personalItemCount;

    const renderItemsTable = (rows) => {
        if (!rows.length) {
            return '<p class="text-sm text-muted">No items out.</p>';
        }

        return `
            <div style="overflow-x:auto;">
                <table class="table" style="margin-top:0.5rem;">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>QTY</th>
                            <th>Due</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(row => `
                            <tr>
                                <td>${escapeHtml(row.itemName)}</td>
                                <td class="text-muted font-mono" style="font-size:0.8rem;">${escapeHtml(row.sku || 'N/A')}</td>
                                <td>${row.quantity}</td>
                                <td>${row.dueDate ? escapeHtml(new Date(row.dueDate).toLocaleString()) : 'No due date'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    };

    const projectGroups = [];
    const projectGroupMap = new Map();
    projectRows.forEach(row => {
        const existing = projectGroupMap.get(row.projectId);
        if (existing) {
            existing.rows.push(row);
            existing.itemCount += row.quantity;
            return;
        }

        const group = {
            projectId: row.projectId,
            projectName: row.projectName,
            itemCount: row.quantity,
            rows: [row]
        };
        projectGroupMap.set(row.projectId, group);
        projectGroups.push(group);
    });

    const projectSectionsHtml = projectGroups.length
        ? projectGroups.map(group => `
            <div class="glass-panel" style="padding:0.85rem;margin-top:0.85rem;">
                <div class="font-bold" style="margin-bottom:0.35rem;">${escapeHtml(group.projectName)} (${group.itemCount} item${group.itemCount === 1 ? '' : 's'})</div>
                ${renderItemsTable(group.rows)}
            </div>
        `).join('')
        : '<p class="text-sm text-muted" style="margin-top:0.65rem;">No project items out.</p>';

    const itemsHtml = `
        <div class="glass-panel" style="padding:1rem;display:flex;gap:0.75rem;align-items:center;justify-content:space-between;flex-wrap:wrap;">
            <div>
                <div class="font-bold" style="font-size:1rem;">${projectCount} project${projectCount === 1 ? '' : 's'}, ${projectItemCount} project item${projectItemCount === 1 ? '' : 's'}</div>
                <div class="text-sm text-muted">Personal items: ${personalItemCount} | Total items out: ${totalItemCount}</div>
            </div>
            <span class="badge">${user.role}</span>
        </div>
        <div class="glass-panel" style="padding:0.85rem;margin-top:0.85rem;">
            <div class="font-bold">My Items (Personal)</div>
            ${renderItemsTable(personalRows)}
        </div>
        <div style="margin-top:0.85rem;">
            <div class="font-bold">Project Items</div>
            ${projectSectionsHtml}
        </div>
    `;

    const html = `
        <div class="modal-header">
            <h3>${user.name} - Items Out</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body" style="max-height:65vh;overflow-y:auto;">
            ${itemsHtml}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `;

    openModal(html);
}

document.getElementById('add-user-btn')?.addEventListener('click', async () => {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to manage users.', 'error');
        return;
    }
    const authOk = await ensurePrivilegedActionAuth('adding users');
    if (!authOk) return;
    openUserModal();
});

document.getElementById('users-search-input')?.addEventListener('input', () => {
    renderUsers();
});

document.getElementById('view-requests-btn')?.addEventListener('click', () => {
    ordersTabMode = 'requests';
    switchPage('orders', 'Operations Hub').catch(err => {
        console.error('Failed to open Orders/Requests view:', err);
        showToast('Unable to open requests tab.', 'error');
    });
});

async function handleProfilePrivilegedPasswordAction() {
    if (!userCanPerformPrivilegedActions()) {
        showToast('Only teacher/developer accounts can change the authentication password.', 'error');
        return;
    }

    const changed = await promptSetPrivilegedActionPassword('updating your authentication password');
    if (changed) privilegedStartupAuditShown = true;
}

function bindProfilePrivilegedActionTrigger(element) {
    element?.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        await handleProfilePrivilegedPasswordAction();
    });
}

bindProfilePrivilegedActionTrigger(userProfileEl);
bindProfilePrivilegedActionTrigger(userNameEl);
bindProfilePrivilegedActionTrigger(userAvatarEl);

userProfileEl?.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    await handleProfilePrivilegedPasswordAction();
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
            <p class="text-sm text-muted">Roles must be 'student' or 'teacher'. Existing IDs are skipped. Course/Grade applies to students only.</p>
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
    
    // Teachers cannot delete restricted accounts
    if (currentUser.role === 'teacher') {
        const developerCount = targetUsers.filter(u => u.role === 'developer').length;
        if (developerCount > 0) {
            showToast(`Teachers cannot delete restricted accounts. ${developerCount} account(s) excluded from deletion.`, 'error');
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
    dynamicModal.classList.remove('debug-modal', 'class-modal', 'order-request-modal');
    const safeFragment = sanitizeModalHtml(contentHtml);
    dynamicModal.replaceChildren(safeFragment);
    modalContainer.classList.remove('hidden');
    focusModalPrimaryInput();
}

function closeModal() {
    modalContainer.classList.add('hidden');
    dynamicModal.replaceChildren();
    dynamicModal.classList.remove('debug-modal', 'class-modal', 'order-request-modal');
}

function focusModalPrimaryInput() {
    const editableFields = Array.from(dynamicModal.querySelectorAll(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'
    )).filter(el => !el.hasAttribute('readonly'));

    if (editableFields.length === 0) return;

    const autofocusField = dynamicModal.querySelector('[autofocus]');
    const targetField = autofocusField || editableFields[0];

    requestAnimationFrame(() => {
        if (!targetField || typeof targetField.focus !== 'function') return;

        targetField.focus({ preventScroll: true });

        if (editableFields.length === 1 && targetField.tagName === 'INPUT') {
            const inputType = String(targetField.type || 'text').toLowerCase();
            const selectableTypes = ['text', 'search', 'email', 'tel', 'url', 'password'];
            if (typeof targetField.select === 'function' && selectableTypes.includes(inputType)) {
                targetField.select();
            }
        }
    });
}

function isEditingInsideOpenModal() {
    if (modalContainer.classList.contains('hidden')) return false;

    const active = document.activeElement;
    const activeIsEditableInModal = !!(
        active
        && dynamicModal.contains(active)
        && active.matches?.('input, textarea, select, [contenteditable="true"]')
    );

    const selection = window.getSelection ? window.getSelection() : null;
    const hasModalTextSelection = !!(
        selection
        && selection.rangeCount > 0
        && !selection.isCollapsed
        && dynamicModal.contains(selection.anchorNode)
    );

    const clipboardRecentlyUsedInModal = (Date.now() - lastModalClipboardInteractionAt) < 1500;

    return activeIsEditableInModal || hasModalTextSelection || clipboardRecentlyUsedInModal;
}

function sanitizeModalHtml(contentHtml) {
    const template = document.createElement('template');
    template.innerHTML = String(contentHtml || '');

    const nodes = template.content.querySelectorAll('*');
    nodes.forEach(node => {
        Array.from(node.attributes).forEach(attr => {
            const name = String(attr.name || '').toLowerCase();
            const value = String(attr.value || '').trim();
            if (name.startsWith('on')) {
                if (name === 'onclick' && /\bcloseModal\s*\(/.test(value)) {
                    node.setAttribute('data-modal-close', '1');
                }
                node.removeAttribute(attr.name);
                return;
            }
            if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
                node.removeAttribute(attr.name);
            }
        });
    });

    template.content.querySelectorAll('script').forEach(s => s.remove());
    return template.content;
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? 'ph-check-circle' : type === 'error' ? 'ph-warning-circle' : 'ph-info';

    const iconEl = document.createElement('i');
    iconEl.className = `ph ${icon}`;
    iconEl.style.fontSize = '1.5rem';

    const messageEl = document.createElement('span');
    messageEl.textContent = String(message || '');

    toast.appendChild(iconEl);
    toast.appendChild(messageEl);

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Close Modal on outside click
modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) {
        if (isEditingInsideOpenModal()) return;
        closeModal();
    }
});

// Keep modal interactions isolated from global document/login click handlers.
dynamicModal.addEventListener('click', (e) => {
    const closeTrigger = e.target?.closest?.('[data-modal-close="1"], .close-btn');
    if (closeTrigger) {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
        return;
    }
    e.stopPropagation();
});
dynamicModal.addEventListener('mousedown', (e) => {
    e.stopPropagation();
});

['copy', 'cut', 'paste'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        if (modalContainer.classList.contains('hidden')) return;
        if (!dynamicModal.contains(e.target)) return;
        lastModalClipboardInteractionAt = Date.now();
    }, true);
});

// Setup Add Item flow
document.getElementById('add-item-btn')?.addEventListener('click', openAddItemModal);

async function openAddItemModal() {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to add inventory items.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('adding inventory items');
    if (!authOk) return;

    const categoryOptions = categories.length > 0
        ? categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
        : '<option value="Uncategorized">Uncategorized</option>';

    const tagCheckboxes = visibilityTags.map(tag =>
        `<label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.4rem">
            <input type="checkbox" class="add-item-tag-cb" value="${escapeHtml(tag)}"> ${escapeHtml(tag)}
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
                <label>Barcode Prefix (optional, 2 letters)</label>
                <input type="text" id="add-sku-prefix" class="form-control" maxlength="2" placeholder="e.g. EL">
                <small class="text-muted">If blank, category initials are used when auto-generating SKU/barcode.</small>
            </div>
            <div class="form-group">
                <label>SKU / Barcode</label>
                <input type="text" id="add-sku" class="form-control" placeholder="Leave blank to auto-generate">
            </div>
            <div class="form-group">
                <label>Part Number (Optional)</label>
                <input type="text" id="add-part-number" class="form-control" placeholder="e.g. SRM-42-001">
            </div>
            <div class="grid-2-col" style="gap:1rem">
                <div class="form-group">
                    <label>Storage Location</label>
                    <input type="text" id="add-storage-location" class="form-control" placeholder="e.g. Cabinet A3">
                </div>
                <div class="form-group">
                    <label>Brand</label>
                    <input type="text" id="add-brand" class="form-control" placeholder="e.g. Bosch">
                </div>
            </div>
            <div class="grid-2-col" style="gap:1rem">
                <div class="form-group">
                    <label>Supplier</label>
                    <input type="text" id="add-supplier" class="form-control" placeholder="e.g. DigiKey">
                </div>
                <div class="form-group">
                    <label>Image Link</label>
                    <input type="url" id="add-image-link" class="form-control" placeholder="https://...">
                </div>
            </div>
            <div class="form-group">
                <label>Supplier Product Listing Link</label>
                <input type="url" id="add-supplier-link" class="form-control" placeholder="https://...">
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
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Add at least one tag for student visibility. Untagged items are hidden from students.</small>
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
        const manualSku = normalizeSkuToken(document.getElementById('add-sku').value);
        const skuPrefixRaw = normalizeSkuToken(document.getElementById('add-sku-prefix')?.value || '');
        const partNumber = document.getElementById('add-part-number')?.value.trim() || '';
        const storageLocation = document.getElementById('add-storage-location')?.value.trim() || '';
        const brand = document.getElementById('add-brand')?.value.trim() || '';
        const supplier = document.getElementById('add-supplier')?.value.trim() || '';
        const imageLink = document.getElementById('add-image-link')?.value.trim() || '';
        const supplierLink = document.getElementById('add-supplier-link')?.value.trim() || '';
        const itemType = document.getElementById('add-item-type')?.value || 'item';
        const visibilityLevel = document.getElementById('add-visibility-level')?.value || 'standard';
        const stock = Math.max(0, parseInt(document.getElementById('add-stock').value, 10) || 0);
        const threshold = Math.max(0, parseInt(document.getElementById('add-threshold').value, 10) || 0);
        const selectedTags = Array.from(document.querySelectorAll('.add-item-tag-cb:checked')).map(cb => cb.value);

        if (!name) {
            showToast('Item name is required.', 'error');
            return;
        }

        const derivedCategoryPrefix = normalizeSkuToken(category).slice(0, 2);
        const prefix = (skuPrefixRaw || derivedCategoryPrefix || normalizeSkuToken(name).slice(0, 2) || 'IT').slice(0, 2);
        const autoSku = `${prefix}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        const finalSku = manualSku || autoSku;

        if (isSkuInUse(finalSku)) {
            showToast('SKU/barcode already exists. Please use a unique value.', 'error');
            return;
        }

        const newItem = {
            id: generateId('ITM'),
            name,
            category,
            sku: finalSku,
            stock,
            threshold,
            part_number: partNumber || null,
            location: storageLocation || null,
            storageLocation: storageLocation || null,
            brand: brand || null,
            supplier: supplier || null,
            image_link: imageLink || null,
            supplier_listing_link: supplierLink || null,
            item_type: itemType,
            visibility_level: visibilityLevel,
            visibilityTags: selectedTags
        };

        const createdItem = await addItemToSupabase(newItem);
        if (!createdItem) {
            showToast('Failed to add item in database.', 'error');
            return;
        }

        const persistedItemId = createdItem.id || newItem.id;
        const tagsSaved = await setItemVisibilityTagsInSupabase(persistedItemId, selectedTags);
        if (!tagsSaved) {
            showToast('Item created, but visibility tags failed to save.', 'warning');
        }

        await refreshInventoryFromSupabase();
        addLog(currentUser.id, 'Barcode Created', `Barcode ${newItem.sku} assigned to ${name}.`);
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
        showToast('Only project owners or teachers can edit this project.', 'error');
        return;
    }

    const canAssignOwner = currentUser.role !== 'student';
    const ownerCandidates = getProjectOwnerCandidates();
    const ownerOptions = ownerCandidates.map(student =>
        `<option value="${escapeHtml(student.id)}" ${student.id === project.ownerId ? 'selected' : ''}>${escapeHtml(student.name)} (${escapeHtml(student.id)})</option>`
    ).join('');

    const collaboratorOptions = buildProjectCollaboratorOptions({
        selectedOwnerId: project.ownerId,
        selectedCollaborators: project.collaborators || []
    });

    const html = `
        <div class="modal-header">
            <h3>Edit Project: ${escapeHtml(project.name)}</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Project Name</label>
                <input type="text" id="edit-proj-name" class="form-control" value="${escapeHtml(project.name)}">
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea id="edit-proj-desc" class="form-control" rows="3">${escapeHtml(project.description)}</textarea>
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
                    ${ownerOptions || '<option value="">No eligible users found</option>'}
                </select>
                <small class="text-muted">Teachers and developers can assign ownership to eligible users.</small>
            </div>` : ''}
            <div class="form-group">
                <label>Collaborators</label>
                <div id="edit-proj-collaborators-wrap" class="glass-panel" style="padding:1rem; max-height:180px; overflow-y:auto">
                    ${collaboratorOptions || '<p class="text-sm text-muted">No eligible student collaborators.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            ${canCurrentUserDeleteProject(project) ? `
            <button class="btn btn-danger" id="edit-proj-delete">
                <i class="ph ph-trash"></i> Delete Project
            </button>` : ''}
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

    document.getElementById('edit-proj-delete')?.addEventListener('click', () => {
        closeModal();
        openDeleteProjectModal(project.id);
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
                showToast('Failed to update project in database.', 'error');
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
    const ownerCandidates = getProjectOwnerCandidates();
    const defaultOwnerId = canAssignOwner
        ? (ownerCandidates[0]?.id || '')
        : currentUser.id;

    const ownerOptions = ownerCandidates.map(student =>
        `<option value="${escapeHtml(student.id)}" ${student.id === defaultOwnerId ? 'selected' : ''}>${escapeHtml(student.name)} (${escapeHtml(student.id)})</option>`
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
                    ${ownerOptions || '<option value="">No eligible users found</option>'}
                </select>
                <small class="text-muted">Teachers and developers can create projects for eligible users.</small>
            </div>` : ''}
            <div class="form-group">
                <label>Add Collaborators (Optional)</label>
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
                    showToast('Failed to create project in database.', 'error');
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
const ORDER_FORM_CONFIG_STORAGE_KEY = 'orderFormConfigV1';
const ORDER_REPORT_QUEUE_STORAGE_KEY = 'orderReportQueueV1';
const ORDER_FORM_JSON_MARKER = 'ORDER_FORM_JSON::';

const DEFAULT_ORDER_FORM_CONFIG = {
    vendorOptions: ['Amazon', 'DigiKey', 'Mouser', 'McMaster-Carr', 'AliExpress', 'Other'],
    budgetCategories: ['General', 'Classroom', 'Competition', 'Maintenance', 'Emergency'],
    enabledFields: {
        partNumberSku: true,
        estimatedPricePerUnit: true,
        estimatedTotalCost: true,
        optionalImpact: true,
        alternatives: true,
        budgetCategory: true,
        reorder: true,
        notes: true
    }
};

const ORDER_PRIORITY_OPTIONS = [
    { value: 'Low', label: 'Low (nice to have)' },
    { value: 'Medium', label: 'Medium (needed soon)' },
    { value: 'High', label: 'High (blocking progress)' },
    { value: 'Urgent', label: 'Urgent (robot cannot function without it)' }
];

function loadOrderFormConfig() {
    try {
        const raw = localStorage.getItem(ORDER_FORM_CONFIG_STORAGE_KEY);
        if (!raw) return {
            ...DEFAULT_ORDER_FORM_CONFIG,
            enabledFields: { ...DEFAULT_ORDER_FORM_CONFIG.enabledFields }
        };

        const parsed = JSON.parse(raw);
        return {
            vendorOptions: Array.isArray(parsed?.vendorOptions) && parsed.vendorOptions.length > 0
                ? parsed.vendorOptions
                : [...DEFAULT_ORDER_FORM_CONFIG.vendorOptions],
            budgetCategories: Array.isArray(parsed?.budgetCategories) && parsed.budgetCategories.length > 0
                ? parsed.budgetCategories
                : [...DEFAULT_ORDER_FORM_CONFIG.budgetCategories],
            enabledFields: {
                ...DEFAULT_ORDER_FORM_CONFIG.enabledFields,
                ...(parsed?.enabledFields || {})
            }
        };
    } catch {
        return {
            ...DEFAULT_ORDER_FORM_CONFIG,
            enabledFields: { ...DEFAULT_ORDER_FORM_CONFIG.enabledFields }
        };
    }
}

let orderFormConfig = loadOrderFormConfig();

function saveOrderFormConfig(config) {
    const vendorOptions = Array.isArray(config?.vendorOptions) && config.vendorOptions.length > 0
        ? config.vendorOptions
        : [...DEFAULT_ORDER_FORM_CONFIG.vendorOptions];

    if (!vendorOptions.some(option => String(option || '').toLowerCase() === 'other')) {
        vendorOptions.push('Other');
    }

    orderFormConfig = {
        vendorOptions,
        budgetCategories: Array.isArray(config?.budgetCategories) && config.budgetCategories.length > 0
            ? config.budgetCategories
            : [...DEFAULT_ORDER_FORM_CONFIG.budgetCategories],
        enabledFields: {
            ...DEFAULT_ORDER_FORM_CONFIG.enabledFields,
            ...(config?.enabledFields || {})
        }
    };

    localStorage.setItem(ORDER_FORM_CONFIG_STORAGE_KEY, JSON.stringify(orderFormConfig));
}

function buildOrderJustificationWithFormData(partPurpose, formData) {
    return `${String(partPurpose || '').trim()}\n\n${ORDER_FORM_JSON_MARKER}${JSON.stringify(formData || {})}`;
}

function parseOrderJustification(justification) {
    const raw = String(justification || '');
    const markerIndex = raw.indexOf(ORDER_FORM_JSON_MARKER);

    if (markerIndex === -1) {
        return {
            partPurpose: raw,
            formData: null
        };
    }

    const body = raw.slice(0, markerIndex).trim();
    const jsonRaw = raw.slice(markerIndex + ORDER_FORM_JSON_MARKER.length).trim();

    try {
        return {
            partPurpose: body,
            formData: jsonRaw ? JSON.parse(jsonRaw) : null
        };
    } catch {
        return {
            partPurpose: body || raw,
            formData: null
        };
    }
}

function queueOrderReportEvent(eventType, orderRequest, extra = {}) {
    const queueEntry = {
        id: generateId('ORQ'),
        eventType,
        timestamp: new Date().toISOString(),
        orderId: orderRequest?.id || null,
        orderStatus: orderRequest?.status || null,
        requestedByUserId: orderRequest?.requestedByUserId || null,
        requestedByName: orderRequest?.requestedByName || null,
        itemName: orderRequest?.itemName || null,
        quantity: orderRequest?.quantity || null,
        metadata: extra
    };

    let queue = [];
    try {
        queue = JSON.parse(localStorage.getItem(ORDER_REPORT_QUEUE_STORAGE_KEY) || '[]');
        if (!Array.isArray(queue)) queue = [];
    } catch {
        queue = [];
    }

    queue.unshift(queueEntry);
    localStorage.setItem(ORDER_REPORT_QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(0, 500)));
}

function parseOptionalCurrency(value) {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed) || parsed < 0) return null;
    return Math.round(parsed * 100) / 100;
}

function openOrderFormSettingsModal() {
    if (!currentUser || currentUser.role === 'student') {
        showToast('Only staff can configure order form fields.', 'error');
        return;
    }

    const enabled = orderFormConfig.enabledFields || {};
    const vendorLines = (orderFormConfig.vendorOptions || []).join('\n');
    const budgetLines = (orderFormConfig.budgetCategories || []).join('\n');

    const html = `
        <div class="modal-header">
            <h3>Customize Order Form</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Enable/disable optional fields and manage dropdown options for requests.</p>
            <div class="glass-panel" style="padding:0.9rem;margin-bottom:0.8rem;">
                <h4 style="margin-bottom:0.5rem;">Optional Fields</h4>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-part-number" ${enabled.partNumberSku ? 'checked' : ''}> Part Number / SKU</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-price" ${enabled.estimatedPricePerUnit ? 'checked' : ''}> Estimated Price (per unit)</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-total" ${enabled.estimatedTotalCost ? 'checked' : ''}> Estimated Total Cost</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-impact" ${enabled.optionalImpact ? 'checked' : ''}> What happens if we do not order it?</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-alternatives" ${enabled.alternatives ? 'checked' : ''}> Alternatives available?</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-budget" ${enabled.budgetCategory ? 'checked' : ''}> Budget Category</label>
                <label style="display:block;margin-bottom:0.35rem;"><input type="checkbox" id="order-field-reorder" ${enabled.reorder ? 'checked' : ''}> Re-order question</label>
                <label style="display:block;"><input type="checkbox" id="order-field-notes" ${enabled.notes ? 'checked' : ''}> Notes / Special Instructions</label>
            </div>
            <div class="form-group">
                <label>Vendor / Supplier Options (one per line)</label>
                <textarea id="order-vendor-options" class="form-control" rows="6">${escapeHtml(vendorLines)}</textarea>
            </div>
            <div class="form-group">
                <label>Budget Categories (one per line)</label>
                <textarea id="order-budget-options" class="form-control" rows="6">${escapeHtml(budgetLines)}</textarea>
            </div>
            <p class="text-muted" style="font-size:0.85rem;">Future email/transaction reports are staged by queuing local report events for each submission and status update.</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="save-order-form-settings-btn">Save Settings</button>
        </div>
    `;

    openModal(html);

    document.getElementById('save-order-form-settings-btn')?.addEventListener('click', () => {
        const parseOptionLines = (value) => String(value || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const nextConfig = {
            vendorOptions: parseOptionLines(document.getElementById('order-vendor-options')?.value),
            budgetCategories: parseOptionLines(document.getElementById('order-budget-options')?.value),
            enabledFields: {
                partNumberSku: !!document.getElementById('order-field-part-number')?.checked,
                estimatedPricePerUnit: !!document.getElementById('order-field-price')?.checked,
                estimatedTotalCost: !!document.getElementById('order-field-total')?.checked,
                optionalImpact: !!document.getElementById('order-field-impact')?.checked,
                alternatives: !!document.getElementById('order-field-alternatives')?.checked,
                budgetCategory: !!document.getElementById('order-field-budget')?.checked,
                reorder: !!document.getElementById('order-field-reorder')?.checked,
                notes: !!document.getElementById('order-field-notes')?.checked
            }
        };

        saveOrderFormConfig(nextConfig);
        addLog(currentUser.id, 'Orders Settings', 'Updated order form fields and dropdown configuration.');
        showToast('Order form configuration updated.', 'success');
        closeModal();
    });
}

function openOrderRequestModal({ initialName = '' } = {}) {
    if (!currentUser) return;

    const enabled = orderFormConfig.enabledFields || {};
    const vendorOptions = orderFormConfig.vendorOptions || DEFAULT_ORDER_FORM_CONFIG.vendorOptions;
    const budgetCategories = orderFormConfig.budgetCategories || DEFAULT_ORDER_FORM_CONFIG.budgetCategories;

    const vendorOptionsHtml = vendorOptions.map(option =>
        `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`
    ).join('');

    const priorityOptionsHtml = ORDER_PRIORITY_OPTIONS.map(option =>
        `<option value="${option.value}">${option.label}</option>`
    ).join('');

    const budgetOptionsHtml = budgetCategories.map(option =>
        `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`
    ).join('');

    const html = `
        <div class="modal-header">
            <h3>Request Item for Order</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Use this when an item does not exist in inventory or stock is unavailable.</p>
            <div class="form-group">
                <label>Part Name (optional)</label>
                <input type="text" id="order-part-name" class="form-control" placeholder="e.g. Soldering Iron" value="${String(initialName || '').replace(/"/g, '&quot;')}">
            </div>
            <div class="form-group">
                <label>Quantity Needed (optional)</label>
                <input type="number" id="order-quantity-needed" class="form-control" min="1" value="1">
            </div>
            <div class="form-group">
                <label>Vendor / Supplier (optional)</label>
                <select id="order-vendor" class="form-control">
                    ${vendorOptionsHtml}
                </select>
            </div>
            <div class="form-group hidden" id="order-vendor-other-wrap">
                <label>Vendor / Supplier (Other)</label>
                <input type="text" id="order-vendor-other" class="form-control" placeholder="Enter vendor name">
            </div>
            ${enabled.partNumberSku ? `
            <div class="form-group">
                <label>Part Number / SKU (optional)</label>
                <input type="text" id="order-part-number" class="form-control" maxlength="100" placeholder="Short answer">
            </div>` : ''}
            ${enabled.estimatedPricePerUnit ? `
            <div class="form-group">
                <label>Estimated Price (per unit)</label>
                <input type="number" id="order-estimated-price" class="form-control" min="0" step="0.01" placeholder="0.00">
            </div>` : ''}
            ${enabled.estimatedTotalCost ? `
            <div class="form-group">
                <label>Estimated Total Cost</label>
                <input type="number" id="order-estimated-total" class="form-control" min="0" step="0.01" placeholder="0.00">
                <small class="text-muted">If left blank and unit price is provided, total is auto-calculated.</small>
            </div>` : ''}
            <div class="form-group">
                <label>Priority Level</label>
                <select id="order-priority-level" class="form-control">${priorityOptionsHtml}</select>
            </div>
            <div class="form-group">
                <label>What is this part for? (optional)</label>
                <textarea id="order-part-purpose" class="form-control" rows="4" placeholder="Describe usage and context."></textarea>
            </div>
            ${enabled.optionalImpact ? `
            <div class="form-group">
                <label>What happens if we do not order it? (optional)</label>
                <textarea id="order-no-order-impact" class="form-control" rows="3" placeholder="Optional"></textarea>
            </div>` : ''}
            ${enabled.alternatives ? `
            <div class="form-group">
                <label>Are alternatives already available? (optional)</label>
                <select id="order-has-alternatives" class="form-control">
                    <option value="">Select</option>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                </select>
            </div>
            <div class="form-group hidden" id="order-alternatives-details-wrap">
                <label>Alternatives details</label>
                <textarea id="order-alternatives-details" class="form-control" rows="3" placeholder="Explain available alternatives"></textarea>
            </div>` : ''}
            ${enabled.budgetCategory ? `
            <div class="form-group">
                <label>Budget Category</label>
                <select id="order-budget-category" class="form-control">
                    <option value="">Uncategorized</option>
                    ${budgetOptionsHtml}
                </select>
            </div>` : ''}
            ${enabled.reorder ? `
            <div class="form-group">
                <label>Is this a re-order?</label>
                <select id="order-is-reorder" class="form-control">
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                </select>
            </div>` : ''}
            ${enabled.notes ? `
            <div class="form-group">
                <label>Notes / Special Instructions</label>
                <textarea id="order-special-notes" class="form-control" rows="3" placeholder="Optional"></textarea>
            </div>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="submit-order-request-btn">Submit Request</button>
        </div>
    `;

    openModal(html);
    dynamicModal.classList.add('order-request-modal');

    const vendorSelect = document.getElementById('order-vendor');
    const vendorOtherWrap = document.getElementById('order-vendor-other-wrap');
    const alternativesSelect = document.getElementById('order-has-alternatives');
    const alternativesDetailsWrap = document.getElementById('order-alternatives-details-wrap');

    const updateVendorOtherVisibility = () => {
        if (!vendorOtherWrap || !vendorSelect) return;
        const isOther = String(vendorSelect.value || '').trim().toLowerCase() === 'other';
        vendorOtherWrap.classList.toggle('hidden', !isOther);
    };

    const updateAlternativesVisibility = () => {
        if (!alternativesDetailsWrap || !alternativesSelect) return;
        const isYes = String(alternativesSelect.value || '') === 'Yes';
        alternativesDetailsWrap.classList.toggle('hidden', !isYes);
    };

    vendorSelect?.addEventListener('change', updateVendorOtherVisibility);
    alternativesSelect?.addEventListener('change', updateAlternativesVisibility);
    updateVendorOtherVisibility();
    updateAlternativesVisibility();

    document.getElementById('submit-order-request-btn')?.addEventListener('click', async () => {
        const partName = document.getElementById('order-part-name')?.value.trim();
        const quantityNeeded = Math.max(1, parseInt(document.getElementById('order-quantity-needed')?.value, 10) || 1);
        const vendorSelection = document.getElementById('order-vendor')?.value.trim() || '';
        const vendorOther = document.getElementById('order-vendor-other')?.value.trim() || '';
        const partPurpose = document.getElementById('order-part-purpose')?.value.trim();

        const fallbackPartName = partName || 'Unspecified Item';
        const fallbackPartPurpose = partPurpose || 'No purpose provided.';

        const vendorFinal = vendorSelection.toLowerCase() === 'other'
            ? (vendorOther || 'Other')
            : (vendorSelection || 'Unspecified');

        const estimatedPricePerUnit = parseOptionalCurrency(document.getElementById('order-estimated-price')?.value || '');
        let estimatedTotalCost = parseOptionalCurrency(document.getElementById('order-estimated-total')?.value || '');

        if (estimatedTotalCost === null && estimatedPricePerUnit !== null) {
            estimatedTotalCost = Math.round((estimatedPricePerUnit * quantityNeeded) * 100) / 100;
        }

        const formData = {
            schemaVersion: 1,
            partName: fallbackPartName,
            quantityNeeded,
            vendorSupplier: vendorFinal,
            partNumberSku: document.getElementById('order-part-number')?.value.trim() || '',
            estimatedPricePerUnit,
            estimatedTotalCost,
            priorityLevel: document.getElementById('order-priority-level')?.value || 'Medium',
            partPurpose: fallbackPartPurpose,
            noOrderImpact: document.getElementById('order-no-order-impact')?.value.trim() || '',
            hasAlternatives: document.getElementById('order-has-alternatives')?.value || '',
            alternativesExplanation: document.getElementById('order-alternatives-details')?.value.trim() || '',
            budgetCategory: document.getElementById('order-budget-category')?.value || '',
            isReorder: document.getElementById('order-is-reorder')?.value || 'No',
            notes: document.getElementById('order-special-notes')?.value.trim() || '',
            reporting: {
                emailStatus: 'queued-not-configured',
                transactionReportStatus: 'queued-not-configured'
            }
        };

        const request = {
            id: generateId('ORD'),
            requestedByUserId: currentUser.id,
            requestedByName: currentUser.name,
            itemName: fallbackPartName,
            category: formData.budgetCategory || 'Uncategorized',
            quantity: quantityNeeded,
            justification: buildOrderJustificationWithFormData(fallbackPartPurpose, formData),
            status: 'Pending',
            timestamp: new Date().toISOString()
        };

        const created = await addOrderRequestToSupabase(request);
        if (!created) {
            showToast('Failed to submit order request to database.', 'error');
            return;
        }

        queueOrderReportEvent('order_submitted', request, {
            priorityLevel: formData.priorityLevel,
            estimatedTotalCost: formData.estimatedTotalCost,
            vendorSupplier: formData.vendorSupplier
        });

        await refreshRequestsFromSupabase();
        addLog(currentUser.id, 'Order Request', `Requested order: ${quantityNeeded}x ${fallbackPartName} (${formData.priorityLevel})`);
        showToast('Order request submitted.', 'success');
        closeModal();

        if (document.getElementById('page-orders')?.classList.contains('active')) {
            renderOrders();
        }
    });
}

function setOrdersPanelBody(tbody, html, colSpan = 8) {
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colSpan;
    td.innerHTML = html;
    tr.appendChild(td);
    tbody.appendChild(tr);
}

async function fetchAllKioskSettingsRows() {
    const client = getSettingsSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.from('kiosk_settings').select('*');
    if (error) return [];
    return Array.isArray(data) ? data : [];
}

async function persistKioskManageConfigToSupabase() {
    const client = getSettingsSupabaseClient();
    if (!client || !kioskId) return false;

    let { error } = await client.from('kiosk_settings').upsert([{
        kiosk_id: kioskId,
        location_label: kioskManageConfig.location || null,
        branding_text: kioskManageConfig.brandingText || null,
        feature_flags_json: kioskManageConfig.featureFlags
    }], { onConflict: 'kiosk_id' });

    if (!error) return true;

    ({ error } = await client.from('kiosk_settings').upsert([{
        kiosk_id: kioskId,
        location: kioskManageConfig.location || null,
        branding: kioskManageConfig.brandingText || null,
        feature_flags: JSON.stringify(kioskManageConfig.featureFlags)
    }], { onConflict: 'kiosk_id' }));

    return !error;
}

function getPrivilegedHistoryRows() {
    const pattern = /privileged|archive flag|orders settings|manage categories|bulk delete|bulk suspend|delete user|create class|edit class|kiosk lock|emergency lockout|recovery/i;
    return (activityLogs || []).filter(log => pattern.test(String(log.action || '')));
}

function buildAuditRows({ actionFilter = '', actorFilter = 'all', privilegedOnly = false } = {}) {
    const normalizedFilter = String(actionFilter || '').trim().toLowerCase();
    let rows = [...(activityLogs || [])];

    if (normalizedFilter) {
        rows = rows.filter(log => {
            const action = String(log.action || '').toLowerCase();
            const details = String(log.details || '').toLowerCase();
            return action.includes(normalizedFilter) || details.includes(normalizedFilter);
        });
    }

    if (actorFilter !== 'all') {
        rows = rows.filter(log => {
            const actorId = log.userId || log.user_id;
            const actor = mockUsers.find(user => user.id === actorId);
            if (!actor) return actorFilter === 'system';
            if (actorFilter === 'staff') return actor.role === 'teacher' || actor.role === 'developer';
            return actor.role === actorFilter;
        });
    }

    if (privilegedOnly) {
        const idSet = new Set(getPrivilegedHistoryRows().map(log => log.id));
        rows = rows.filter(log => idSet.has(log.id));
    }

    rows.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return rows;
}

function renderOrdersKioskMode(tbody) {
    const lockScreenLabel = getKioskLockScreen(kioskLiveStatus.lastKnownLockScreen).label;
    const html = `
        <div class="glass-panel" style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.75rem;">
            <div><strong>Status:</strong> ${kioskLiveStatus.realtimeConnected ? 'Online' : 'Offline'}</div>
            <div><strong>Lock:</strong> ${kioskLiveStatus.lastKnownLockState ? 'Locked' : 'Unlocked'} (${escapeHtml(lockScreenLabel)})</div>
            <div><strong>Version:</strong> ${escapeHtml(kioskLiveStatus.lastSettingsVersion || appVersion)}</div>
            <div><strong>Last Sync:</strong> ${escapeHtml(kioskLiveStatus.lastSyncAt ? new Date(kioskLiveStatus.lastSyncAt).toLocaleString() : 'Never')}</div>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4 style="margin-bottom:0.6rem;">Remote Controls</h4>
            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                <button class="btn btn-secondary" id="hub-kiosk-refresh">Refresh</button>
                <button class="btn btn-danger" id="hub-kiosk-lock">Lock</button>
                <button class="btn btn-primary" id="hub-kiosk-unlock">Unlock</button>
                <button class="btn btn-secondary" id="hub-kiosk-pulse">Unlock Pulse (20s)</button>
                <button class="btn btn-danger" id="hub-kiosk-lockout">Emergency Lockout</button>
            </div>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4 style="margin-bottom:0.6rem;">Kiosk Configuration</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;">
                <div class="form-group"><label>Location</label><input id="hub-kiosk-location" class="form-control" value="${escapeHtml(kioskManageConfig.location)}"></div>
                <div class="form-group"><label>Branding Text</label><input id="hub-kiosk-branding" class="form-control" value="${escapeHtml(kioskManageConfig.brandingText)}"></div>
            </div>
            <div style="display:flex;gap:0.8rem;flex-wrap:wrap;margin-top:0.5rem;">
                <label style="display:flex;gap:0.35rem;align-items:center;"><input type="checkbox" id="hub-kiosk-flag-pulse" ${kioskManageConfig.featureFlags.allowUnlockPulse ? 'checked' : ''}> Unlock pulse</label>
                <label style="display:flex;gap:0.35rem;align-items:center;"><input type="checkbox" id="hub-kiosk-flag-lockout" ${kioskManageConfig.featureFlags.allowEmergencyLockout ? 'checked' : ''}> Emergency lockout</label>
                <label style="display:flex;gap:0.35rem;align-items:center;"><input type="checkbox" id="hub-kiosk-flag-csv" ${kioskManageConfig.featureFlags.enableAuditCsvExport ? 'checked' : ''}> CSV export</label>
            </div>
            <button class="btn btn-primary" id="hub-kiosk-save-config" style="margin-top:0.6rem;">Save Configuration</button>
        </div>
    `;

    setOrdersPanelBody(tbody, html);

    document.getElementById('hub-kiosk-refresh')?.addEventListener('click', async () => {
        const settings = await fetchKioskSettings(kioskId);
        kioskLiveStatus.lastSyncAt = new Date().toISOString();
        kioskLiveStatus.lastSettingsVersion = String(settings.app_version || '').trim();
        kioskLiveStatus.lastKnownLockState = !!settings.is_locked;
        kioskLiveStatus.lastKnownLockScreen = String(settings.lock_screen || 'systemLocked');
        renderOrders();
    });

    document.getElementById('hub-kiosk-lock')?.addEventListener('click', async () => {
        await applyKioskLock(true, debugConfig.kioskLockScreen || 'systemLocked', { syncRemote: true });
        addLog(currentUser.id, 'Kiosk Lock Change', 'Remote kiosk locked from Operations Hub.');
        renderOrders();
    });

    document.getElementById('hub-kiosk-unlock')?.addEventListener('click', async () => {
        await applyKioskLock(false, debugConfig.kioskLockScreen || 'systemLocked', { syncRemote: true });
        addLog(currentUser.id, 'Kiosk Lock Change', 'Remote kiosk unlocked from Operations Hub.');
        renderOrders();
    });

    document.getElementById('hub-kiosk-pulse')?.addEventListener('click', async () => {
        if (!kioskManageConfig.featureFlags.allowUnlockPulse) {
            showToast('Unlock pulse is disabled by feature flags.', 'error');
            return;
        }
        await applyKioskLock(false, debugConfig.kioskLockScreen || 'systemLocked', { syncRemote: true });
        addLog(currentUser.id, 'Remote Unlock Pulse', 'Triggered kiosk unlock pulse for 20 seconds.');
        setTimeout(() => {
            applyKioskLock(true, debugConfig.kioskLockScreen || 'systemLocked', { syncRemote: true });
        }, 20000);
        showToast('Unlock pulse triggered for 20 seconds.', 'success');
    });

    document.getElementById('hub-kiosk-lockout')?.addEventListener('click', async () => {
        if (!kioskManageConfig.featureFlags.allowEmergencyLockout) {
            showToast('Emergency lockout is disabled by feature flags.', 'error');
            return;
        }
        await applyKioskLock(true, 'outOfOrder', { syncRemote: true });
        await addSystemFlagToSupabase({
            id: generateId('FLAG'),
            flag_type: 'Emergency Lockout',
            actor_user_id: currentUser.id,
            details: `${currentUser.name} triggered emergency kiosk lockout.`,
            status: 'Open',
            timestamp: new Date().toISOString()
        });
        addLog(currentUser.id, 'Emergency Lockout', 'Emergency lockout triggered from Operations Hub.');
        await refreshRequestsFromSupabase();
        renderOrders();
    });

    document.getElementById('hub-kiosk-save-config')?.addEventListener('click', async () => {
        saveKioskManageConfig({
            location: document.getElementById('hub-kiosk-location')?.value || '',
            brandingText: document.getElementById('hub-kiosk-branding')?.value || '',
            featureFlags: {
                ...kioskManageConfig.featureFlags,
                allowUnlockPulse: !!document.getElementById('hub-kiosk-flag-pulse')?.checked,
                allowEmergencyLockout: !!document.getElementById('hub-kiosk-flag-lockout')?.checked,
                enableAuditCsvExport: !!document.getElementById('hub-kiosk-flag-csv')?.checked
            }
        });
        applyKioskManageBranding();
        const synced = await persistKioskManageConfigToSupabase();
        addLog(currentUser.id, 'Kiosk Configuration', `Kiosk config saved (location=${kioskManageConfig.location || 'N/A'}).`);
        showToast(synced ? 'Kiosk configuration saved.' : 'Saved locally. Remote columns unavailable.', synced ? 'success' : 'warning');
    });
}

function renderOrdersPolicyMode(tbody) {
    const due = normalizeDuePolicy(policyConfig.duePolicy);
    const constraints = policyConfig.checkoutConstraints;
    const access = policyConfig.accessLevelDefaults;
    const health = policyConfig.healthThresholds;

    const html = `
        <div class="glass-panel" style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;">
            <div class="form-group"><label>Default Due Minutes</label><input id="hub-policy-due" class="form-control" type="number" min="1" value="${due.defaultSignoutMinutes}"></div>
            <div class="form-group"><label>Timezone</label><select id="hub-policy-timezone" class="form-control">${buildTimezoneOptionsHtml(due.timezone)}</select></div>
            <div class="form-group"><label>Max Total Qty / Checkout</label><input id="hub-policy-max-qty" class="form-control" type="number" min="1" value="${constraints.maxItemsPerCheckout}"></div>
            <div class="form-group"><label>Max Distinct Items / Checkout</label><input id="hub-policy-max-distinct" class="form-control" type="number" min="1" value="${constraints.maxDistinctItemsPerCheckout}"></div>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4 style="margin-bottom:0.55rem;">Access-Level Defaults</h4>
            <label style="display:flex;gap:0.35rem;align-items:center;margin-bottom:0.4rem;"><input id="hub-policy-access-create" type="checkbox" ${access.canCreateProjects ? 'checked' : ''}> Can Create Projects</label>
            <label style="display:flex;gap:0.35rem;align-items:center;margin-bottom:0.4rem;"><input id="hub-policy-access-join" type="checkbox" ${access.canJoinProjects ? 'checked' : ''}> Can Join Projects</label>
            <label style="display:flex;gap:0.35rem;align-items:center;"><input id="hub-policy-access-signout" type="checkbox" ${access.canSignOut ? 'checked' : ''}> Can Sign Out Items</label>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;">
            <div class="form-group"><label>Login Failure Alert Threshold</label><input id="hub-health-login-threshold" class="form-control" type="number" min="1" value="${health.loginFailureThreshold}"></div>
            <div class="form-group"><label>Unlock Failure Alert Threshold</label><input id="hub-health-unlock-threshold" class="form-control" type="number" min="1" value="${health.unlockFailureThreshold}"></div>
            <div class="form-group"><label>Stale Kiosk Minutes</label><input id="hub-health-stale-threshold" class="form-control" type="number" min="5" value="${health.staleKioskMinutes}"></div>
        </div>
        <div style="margin-top:0.7rem;"><button class="btn btn-primary" id="hub-policy-save">Save Policy Controls</button></div>
    `;

    setOrdersPanelBody(tbody, html);

    document.getElementById('hub-policy-save')?.addEventListener('click', () => {
        savePolicyConfig({
            duePolicy: {
                defaultSignoutMinutes: parseInt(document.getElementById('hub-policy-due')?.value, 10) || due.defaultSignoutMinutes,
                timezone: document.getElementById('hub-policy-timezone')?.value || due.timezone,
                periodRanges: due.periodRanges
            },
            checkoutConstraints: {
                maxItemsPerCheckout: parseInt(document.getElementById('hub-policy-max-qty')?.value, 10) || constraints.maxItemsPerCheckout,
                maxDistinctItemsPerCheckout: parseInt(document.getElementById('hub-policy-max-distinct')?.value, 10) || constraints.maxDistinctItemsPerCheckout,
                allowStudentAssignOthers: constraints.allowStudentAssignOthers
            },
            accessLevelDefaults: {
                canCreateProjects: !!document.getElementById('hub-policy-access-create')?.checked,
                canJoinProjects: !!document.getElementById('hub-policy-access-join')?.checked,
                canSignOut: !!document.getElementById('hub-policy-access-signout')?.checked
            },
            healthThresholds: {
                loginFailureThreshold: parseInt(document.getElementById('hub-health-login-threshold')?.value, 10) || health.loginFailureThreshold,
                unlockFailureThreshold: parseInt(document.getElementById('hub-health-unlock-threshold')?.value, 10) || health.unlockFailureThreshold,
                staleKioskMinutes: parseInt(document.getElementById('hub-health-stale-threshold')?.value, 10) || health.staleKioskMinutes
            }
        });
        addLog(currentUser.id, 'Policy Controls Updated', 'Policy controls updated from Operations Hub.');
        showToast('Policy controls saved.', 'success');
    });
}

function renderOrdersAuditMode(tbody) {
    const html = `
        <div class="glass-panel" style="padding:1rem;display:flex;gap:0.65rem;flex-wrap:wrap;align-items:flex-end;">
            <div class="form-group" style="min-width:220px;"><label>Search</label><input id="hub-audit-search" class="form-control" placeholder="Action or details"></div>
            <div class="form-group" style="min-width:170px;"><label>Actor</label>
                <select id="hub-audit-actor" class="form-control">
                    <option value="all">All</option>
                    <option value="staff">Staff</option>
                    <option value="student">Students</option>
                    <option value="system">System</option>
                </select>
            </div>
            <label style="display:flex;gap:0.35rem;align-items:center;margin-bottom:0.6rem;"><input id="hub-audit-privileged" type="checkbox"> Privileged Only</label>
            <button class="btn btn-secondary" id="hub-audit-apply">Apply</button>
            <button class="btn btn-primary" id="hub-audit-export">Export CSV</button>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;max-height:440px;overflow:auto;" id="hub-audit-results"></div>
    `;
    setOrdersPanelBody(tbody, html);

    const drawRows = () => {
        const rows = buildAuditRows({
            actionFilter: document.getElementById('hub-audit-search')?.value || '',
            actorFilter: document.getElementById('hub-audit-actor')?.value || 'all',
            privilegedOnly: !!document.getElementById('hub-audit-privileged')?.checked
        });
        const results = document.getElementById('hub-audit-results');
        if (!results) return;
        if (rows.length === 0) {
            results.innerHTML = '<p class="text-muted">No audit rows matched current filters.</p>';
            return;
        }
        results.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
                <tbody>
                    ${rows.slice(0, 400).map(log => {
                        const actorId = log.userId || log.user_id;
                        const actor = mockUsers.find(user => user.id === actorId);
                        return `<tr>
                            <td><small>${new Date(log.timestamp || Date.now()).toLocaleString()}</small></td>
                            <td>${escapeHtml(actor?.name || actorId || 'SYSTEM')}</td>
                            <td><strong>${escapeHtml(String(log.action || ''))}</strong></td>
                            <td>${escapeHtml(String(log.details || ''))}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        `;
    };

    document.getElementById('hub-audit-apply')?.addEventListener('click', drawRows);
    document.getElementById('hub-audit-export')?.addEventListener('click', () => {
        if (!kioskManageConfig.featureFlags.enableAuditCsvExport) {
            showToast('CSV export is disabled by feature flags.', 'error');
            return;
        }
        const rows = buildAuditRows({
            actionFilter: document.getElementById('hub-audit-search')?.value || '',
            actorFilter: document.getElementById('hub-audit-actor')?.value || 'all',
            privilegedOnly: !!document.getElementById('hub-audit-privileged')?.checked
        });
        downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, ['timestamp', 'actor', 'action', 'details'], rows.map(row => [
            row.timestamp,
            row.userId || row.user_id || 'SYSTEM',
            row.action || '',
            row.details || ''
        ]));
    });

    drawRows();
}

async function renderOrdersHealthMode(tbody) {
    setOrdersPanelBody(tbody, '<div class="glass-panel" style="padding:1rem;">Loading health alerts...</div>');

    const now = Date.now();
    const lookbackMs = 30 * 60 * 1000;
    const loginThreshold = Math.max(1, parseInt(policyConfig.healthThresholds.loginFailureThreshold, 10) || 5);
    const unlockThreshold = Math.max(1, parseInt(policyConfig.healthThresholds.unlockFailureThreshold, 10) || 3);
    const staleMinutes = Math.max(5, parseInt(policyConfig.healthThresholds.staleKioskMinutes, 10) || 45);

    const recent = (activityLogs || []).filter(log => now - new Date(log.timestamp || 0).getTime() <= lookbackMs);
    const logins = recent.filter(log => String(log.action || '').toLowerCase().includes('login failed'));
    const unlocks = recent.filter(log => String(log.action || '').toLowerCase().includes('door access failed'));

    const countByActor = (rows) => rows.reduce((acc, row) => {
        const key = String(row.userId || row.user_id || 'SYSTEM');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const loginCounts = countByActor(logins);
    const unlockCounts = countByActor(unlocks);

    const loginAlerts = Object.entries(loginCounts).filter(([, count]) => count >= loginThreshold);
    const unlockAlerts = Object.entries(unlockCounts).filter(([, count]) => count >= unlockThreshold);

    const kioskRows = await fetchAllKioskSettingsRows();
    const staleKiosks = kioskRows.filter(row => {
        const marker = row.updated_at || row.last_sync_at || row.modified_at || row.created_at;
        if (!marker) return true;
        const ageMinutes = (now - new Date(marker).getTime()) / 60000;
        return ageMinutes > staleMinutes;
    });

    const html = `
        <div class="glass-panel" style="padding:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0.75rem;">
            <div><strong>Login Failure Alerts:</strong> ${loginAlerts.length}</div>
            <div><strong>Unlock Failure Alerts:</strong> ${unlockAlerts.length}</div>
            <div><strong>Stale Kiosks:</strong> ${staleKiosks.length}</div>
            <div><strong>Window:</strong> 30 minutes</div>
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4>Repeated Login Failures</h4>
            ${loginAlerts.length === 0 ? '<p class="text-muted">No repeated login failures detected.</p>' : `<ul class="stock-list">${loginAlerts.map(([actor, count]) => `<li class="stock-item"><span>${escapeHtml(actor)}</span><span class="text-danger">${count}</span></li>`).join('')}</ul>`}
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4>Repeated Unlock Failures</h4>
            ${unlockAlerts.length === 0 ? '<p class="text-muted">No repeated unlock failures detected.</p>' : `<ul class="stock-list">${unlockAlerts.map(([actor, count]) => `<li class="stock-item"><span>${escapeHtml(actor)}</span><span class="text-danger">${count}</span></li>`).join('')}</ul>`}
        </div>
        <div class="glass-panel" style="padding:1rem;margin-top:0.8rem;">
            <h4>Stale Kiosks (>${staleMinutes} min)</h4>
            ${staleKiosks.length === 0 ? '<p class="text-muted">No stale kiosks detected.</p>' : `<ul class="stock-list">${staleKiosks.map(row => `<li class="stock-item"><span>${escapeHtml(String(row.kiosk_id || 'Unknown'))}</span><span class="text-warning">${escapeHtml(String(row.updated_at || row.last_sync_at || 'Unknown'))}</span></li>`).join('')}</ul>`}
        </div>
    `;

    setOrdersPanelBody(tbody, html);
}

function renderOrdersRecoveryMode(tbody) {
    const snapshots = getStoredConfigSnapshots();
    const html = `
        <div class="glass-panel" style="padding:1rem;">
            <h4 style="margin-bottom:0.6rem;">Configuration Recovery</h4>
            <div style="display:flex;gap:0.65rem;flex-wrap:wrap;align-items:flex-end;">
                <div class="form-group" style="min-width:260px;flex:1;"><label>Snapshot Label</label><input id="hub-snapshot-label" class="form-control" placeholder="Before policy changes"></div>
                <button class="btn btn-primary" id="hub-snapshot-create">Capture Snapshot</button>
            </div>
            <div id="hub-snapshot-list" style="margin-top:0.8rem;"></div>
        </div>
    `;
    setOrdersPanelBody(tbody, html);

    const listWrap = document.getElementById('hub-snapshot-list');
    if (listWrap) {
        if (snapshots.length === 0) {
            listWrap.innerHTML = '<p class="text-muted">No snapshots available yet.</p>';
        } else {
            listWrap.innerHTML = snapshots.map(snapshot => `
                <div class="glass-panel" style="padding:0.7rem;margin-bottom:0.5rem;display:flex;justify-content:space-between;gap:0.7rem;align-items:center;">
                    <div>
                        <div><strong>${escapeHtml(String(snapshot.label || 'Snapshot'))}</strong></div>
                        <small class="text-muted">${new Date(snapshot.createdAt || Date.now()).toLocaleString()}</small>
                    </div>
                    <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
                        <button class="btn btn-secondary hub-snapshot-restore" data-id="${escapeHtml(String(snapshot.id || ''))}">Restore</button>
                        <button class="btn btn-danger hub-snapshot-delete" data-id="${escapeHtml(String(snapshot.id || ''))}">Delete</button>
                    </div>
                </div>
            `).join('');
        }
    }

    document.getElementById('hub-snapshot-create')?.addEventListener('click', () => {
        const label = document.getElementById('hub-snapshot-label')?.value || '';
        const snapshot = createConfigSnapshot(label);
        addLog(currentUser.id, 'Recovery Snapshot', `Created config snapshot ${snapshot.id}.`);
        showToast('Snapshot captured.', 'success');
        renderOrders();
    });

    document.querySelectorAll('.hub-snapshot-restore').forEach(btn => {
        btn.addEventListener('click', () => {
            const snapshotId = btn.getAttribute('data-id');
            const restored = restoreConfigSnapshot(snapshotId);
            if (!restored) {
                showToast('Snapshot restore failed.', 'error');
                return;
            }
            addLog(currentUser.id, 'Recovery Restore', `Restored config snapshot ${snapshotId}.`);
            showToast('Configuration restored.', 'success');
            renderOrders();
        });
    });

    document.querySelectorAll('.hub-snapshot-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const snapshotId = btn.getAttribute('data-id');
            const next = getStoredConfigSnapshots().filter(snapshot => String(snapshot.id) !== String(snapshotId));
            saveConfigSnapshots(next);
            addLog(currentUser.id, 'Recovery Snapshot Delete', `Deleted config snapshot ${snapshotId}.`);
            renderOrders();
        });
    });
}

function renderOrders() {
    const tbody = document.getElementById('orders-table-body');
    const filter = document.getElementById('orders-status-filter');
    const toggleWrap = document.getElementById('orders-student-toggle-wrap');
    const toggle = document.getElementById('orders-student-visible-toggle');
    const newOrderBtn = document.getElementById('new-order-request-btn');
    const configureFormBtn = document.getElementById('configure-order-form-btn');
    const ordersModeButtons = document.querySelectorAll('.orders-mode-btn');
    const ordersHeaderRow = document.querySelector('#page-orders .data-table thead tr');

    if (!tbody || !currentUser) return;

    ordersModeButtons.forEach(btn => {
        const mode = btn.getAttribute('data-mode') || '';
        const restrictedModes = ['kiosk', 'policy', 'audit', 'health', 'recovery'];
        if (currentUser.role === 'student' && restrictedModes.includes(mode)) {
            btn.classList.add('hidden');
            if (ordersTabMode === mode) ordersTabMode = 'orders';
        } else {
            btn.classList.remove('hidden');
        }

        btn.classList.toggle('active', btn.getAttribute('data-mode') === ordersTabMode);
        if (!btn.dataset.bound) {
            btn.addEventListener('click', () => {
                ordersTabMode = btn.getAttribute('data-mode') || 'orders';
                renderOrders();
            });
            btn.dataset.bound = '1';
        }
    });

    if (ordersHeaderRow) {
        // Clear and rebuild header safely
        while (ordersHeaderRow.firstChild) {
            ordersHeaderRow.removeChild(ordersHeaderRow.firstChild);
        }
        const headers = [];
        if (ordersTabMode === 'all') {
            headers = ['Date', 'Kind', 'From', 'Summary', 'Status', 'Actions', '', ''];
        } else if (ordersTabMode === 'orders') {
            headers = ['Date', 'Requested By', 'Part Name', 'Qty', 'Priority', 'Est. Total', 'Status', 'Actions'];
        } else if (ordersTabMode === 'requests') {
            headers = ['Date', 'Type', 'From', 'Details', 'Status', 'Actions', '', ''];
        } else if (ordersTabMode === 'kiosk' || ordersTabMode === 'policy' || ordersTabMode === 'audit' || ordersTabMode === 'health' || ordersTabMode === 'recovery') {
            headers = ['Operations Hub Control Center', '', '', '', '', '', '', ''];
        } else {
            headers = ['Date', 'Flag Type', 'Actor', 'Details', 'Status', 'Actions', '', ''];
        }
        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            ordersHeaderRow.appendChild(th);
        });
    }

    if (filter) {
        filter.style.display = ordersTabMode === 'orders' ? '' : 'none';
    }

    if (toggleWrap) {
        toggleWrap.style.display = (currentUser.role === 'student' || ordersTabMode !== 'orders') ? 'none' : '';
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

    if (newOrderBtn) {
        newOrderBtn.style.display = ordersTabMode === 'orders' ? '' : 'none';
    }

    if (configureFormBtn) {
        configureFormBtn.classList.toggle('hidden', currentUser.role === 'student' || ordersTabMode !== 'orders');
        if (!configureFormBtn.dataset.bound) {
            configureFormBtn.addEventListener('click', () => openOrderFormSettingsModal());
            configureFormBtn.dataset.bound = '1';
        }
    }

    if (currentUser.role === 'student' && !ordersStudentViewEnabled) {
        tbody.replaceChildren();
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.className = 'text-center text-muted';
        td.textContent = 'Orders view is currently disabled for students.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    if (ordersTabMode === 'kiosk') {
        renderOrdersKioskMode(tbody);
        return;
    }

    if (ordersTabMode === 'policy') {
        renderOrdersPolicyMode(tbody);
        return;
    }

    if (ordersTabMode === 'audit') {
        renderOrdersAuditMode(tbody);
        return;
    }

    if (ordersTabMode === 'health') {
        renderOrdersHealthMode(tbody).catch(err => {
            console.error('Failed to render health alerts:', err);
            setOrdersPanelBody(tbody, '<div class="glass-panel" style="padding:1rem;">Unable to load health alerts.</div>');
        });
        return;
    }

    if (ordersTabMode === 'recovery') {
        renderOrdersRecoveryMode(tbody);
        return;
    }

    if (ordersTabMode === 'all') {
        const opsRows = [];

        orderRequests.forEach(r => {
            if (currentUser.role === 'student' && r.requestedByUserId !== currentUser.id) return;
            opsRows.push({
                kind: 'Order',
                timestamp: r.timestamp,
                from: r.requestedByName || r.requestedByUserId,
                summary: `${r.itemName} (x${r.quantity || 1})`,
                status: r.status || 'Pending'
            });
        });

        helpRequests.forEach(r => {
            opsRows.push({
                kind: 'Request',
                timestamp: r.timestamp,
                from: r.name,
                summary: r.description,
                status: r.status || 'Pending'
            });
        });

        extensionRequests.forEach(r => {
            opsRows.push({
                kind: 'Request',
                timestamp: r.timestamp,
                from: r.userName,
                summary: `${r.itemName} extension (${new Date(r.currentDue).toLocaleDateString()} -> ${new Date(r.requestedDue).toLocaleDateString()})`,
                status: r.status || 'Pending'
            });
        });

        (systemFlags || []).filter(flag => flag.status !== 'Archived').forEach(flag => {
            opsRows.push({
                kind: 'Flag',
                timestamp: flag.created_at || flag.timestamp,
                from: flag.actor_user_id || 'System',
                summary: flag.details || flag.flag_type || 'System flag',
                status: flag.status || 'Open'
            });
        });

        opsRows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Clear tbody and build DOM-safe rows
        while (tbody.firstChild) {
            tbody.removeChild(tbody.firstChild);
        }

        if (opsRows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'text-center text-muted';
            td.textContent = 'No operations found.';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            opsRows.forEach(row => {
                const tr = document.createElement('tr');
                
                const statusStyle = row.status === 'Approved' || row.status === 'Ordered' || row.status === 'Resolved'
                    ? 'background:rgba(16,185,129,0.2);color:var(--success)'
                    : row.status === 'Denied'
                        ? 'background:rgba(239,68,68,0.2);color:var(--danger)'
                        : row.status === 'Archived'
                            ? 'background:rgba(107,114,128,0.2);color:var(--text-secondary)'
                            : 'background:rgba(245,158,11,0.2);color:var(--warning)';
                
                const kindLabel = escapeHtml(String(row.kind || '-'));
                const fromLabel = escapeHtml(String(row.from || '-'));
                const summaryLabel = escapeHtml(String(row.summary || '-'));
                const statusLabel = escapeHtml(String(row.status || '-'));
                
                // Date column
                const tdDate = document.createElement('td');
                const smallDate = document.createElement('small');
                smallDate.className = 'text-muted';
                smallDate.textContent = new Date(row.timestamp).toLocaleDateString();
                tdDate.appendChild(smallDate);
                tr.appendChild(tdDate);
                
                // Kind column
                const tdKind = document.createElement('td');
                tdKind.textContent = kindLabel;
                tr.appendChild(tdKind);
                
                // From column
                const tdFrom = document.createElement('td');
                tdFrom.textContent = fromLabel;
                tr.appendChild(tdFrom);
                
                // Summary column
                const tdSummary = document.createElement('td');
                tdSummary.textContent = summaryLabel;
                tr.appendChild(tdSummary);
                
                // Status column
                const tdStatus = document.createElement('td');
                const spanBadge = document.createElement('span');
                spanBadge.className = 'badge';
                spanBadge.style.cssText = statusStyle;
                spanBadge.textContent = statusLabel;
                tdStatus.appendChild(spanBadge);
                tr.appendChild(tdStatus);
                
                // Actions column (empty)
                const tdActions = document.createElement('td');
                tdActions.textContent = '-';
                tr.appendChild(tdActions);
                
                // Spacer columns
                const tdSpacer1 = document.createElement('td');
                tdSpacer1.textContent = '';
                tr.appendChild(tdSpacer1);
                
                const tdSpacer2 = document.createElement('td');
                tdSpacer2.textContent = '';
                tr.appendChild(tdSpacer2);
                
                tbody.appendChild(tr);
            });
        }

        return;
    }

    if (ordersTabMode === 'requests') {
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
                details: `${r.itemName} in ${r.projectName} - Due: ${new Date(r.currentDue).toLocaleDateString()} -> ${new Date(r.requestedDue).toLocaleDateString()}`,
                status: r.status,
                timestamp: r.timestamp,
                sourceArray: 'extension',
                sourceObj: r
            });
        });

        allRequests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Clear tbody and build DOM-safe rows
        while (tbody.firstChild) {
            tbody.removeChild(tbody.firstChild);
        }

        if (allRequests.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'text-center text-muted';
            td.textContent = 'No requests found.';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            allRequests.forEach(r => {
                const tr = document.createElement('tr');
                
                const statusStyle = r.status === 'Approved' ? 'background:rgba(16,185,129,0.2);color:var(--success)' :
                    r.status === 'Denied' ? 'background:rgba(239,68,68,0.2);color:var(--danger)' :
                        r.status === 'Resolved' ? 'background:rgba(16,185,129,0.2);color:var(--success)' :
                            'background:rgba(255,255,255,0.1)';
                
                const typeLabel = escapeHtml(String(r.type || '-'));
                const fromLabel = escapeHtml(String(r.from || '-'));
                const detailsLabel = escapeHtml(String(r.details || '-'));
                const statusLabel = escapeHtml(String(r.status || '-'));
                const reqId = escapeHtml(String(r.id || ''));
                
                // Date column
                const tdDate = document.createElement('td');
                const smallDate = document.createElement('small');
                smallDate.className = 'text-muted';
                smallDate.textContent = new Date(r.timestamp).toLocaleDateString();
                tdDate.appendChild(smallDate);
                tr.appendChild(tdDate);
                
                // Type badge column
                const tdType = document.createElement('td');
                const typeBadge = document.createElement('span');
                typeBadge.className = 'badge';
                typeBadge.style.cssText = 'background: rgba(139,92,246,0.15); color: var(--accent-primary)';
                typeBadge.textContent = typeLabel;
                tdType.appendChild(typeBadge);
                tr.appendChild(tdType);
                
                // From column
                const tdFrom = document.createElement('td');
                const strongFrom = document.createElement('strong');
                strongFrom.textContent = fromLabel;
                tdFrom.appendChild(strongFrom);
                tr.appendChild(tdFrom);
                
                // Details column
                const tdDetails = document.createElement('td');
                tdDetails.textContent = detailsLabel;
                tr.appendChild(tdDetails);
                
                // Status column
                const tdStatus = document.createElement('td');
                const statusBadge = document.createElement('span');
                statusBadge.className = 'badge';
                statusBadge.style.cssText = statusStyle;
                statusBadge.textContent = statusLabel;
                tdStatus.appendChild(statusBadge);
                tr.appendChild(tdStatus);
                
                // Actions column
                const tdActions = document.createElement('td');
                if (r.status === 'Pending' && currentUser.role !== 'student') {
                    if (r.sourceArray === 'extension') {
                        const approveBtn = document.createElement('button');
                        approveBtn.className = 'btn btn-secondary text-sm approve-req-btn';
                        approveBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;margin-right:0.25rem;';
                        approveBtn.textContent = 'Approve';
                        approveBtn.setAttribute('data-id', reqId);
                        
                        const denyBtn = document.createElement('button');
                        denyBtn.className = 'btn btn-danger text-sm deny-req-btn';
                        denyBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;';
                        denyBtn.textContent = 'Deny';
                        denyBtn.setAttribute('data-id', reqId);
                        
                        tdActions.appendChild(approveBtn);
                        tdActions.appendChild(denyBtn);
                    } else {
                        const resolveBtn = document.createElement('button');
                        resolveBtn.className = 'btn btn-secondary text-sm resolve-req-btn2';
                        resolveBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;';
                        resolveBtn.textContent = 'Resolve';
                        resolveBtn.setAttribute('data-id', reqId);
                        tdActions.appendChild(resolveBtn);
                    }
                } else {
                    tdActions.textContent = '-';
                }
                tr.appendChild(tdActions);
                
                // Spacer columns
                const tdSpacer1 = document.createElement('td');
                tdSpacer1.textContent = '';
                tr.appendChild(tdSpacer1);
                
                const tdSpacer2 = document.createElement('td');
                tdSpacer2.textContent = '';
                tr.appendChild(tdSpacer2);
                
                tbody.appendChild(tr);
            });
        }

        document.querySelectorAll('.resolve-req-btn2').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const reqId = e.currentTarget.getAttribute('data-id');
                const req = helpRequests.find(r => r.id === reqId);
                if (!req) return;
                const updated = await updateHelpRequestInSupabase(req.id, 'Resolved');
                if (!updated) {
                    showToast('Failed to resolve help request in database.', 'error');
                    return;
                }
                await refreshRequestsFromSupabase();
                showToast('Help request resolved.', 'success');
                addLog(currentUser.id, 'Resolve Request', `Resolved credential request from ${req.name}`);
                renderOrders();
            });
        });

        document.querySelectorAll('.approve-req-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const reqId = e.currentTarget.getAttribute('data-id');
                const req = extensionRequests.find(r => r.id === reqId);
                if (!req) return;

                const updated = await updateExtensionRequestInSupabase(req.id, 'Approved');
                if (!updated) {
                    showToast('Failed to approve extension request in database.', 'error');
                    return;
                }

                const dueUpdatePromises = [];
                projects.forEach(p => {
                    p.itemsOut.forEach(io => {
                        if (io.itemId === req.itemId && io.dueDate === req.currentDue) {
                            io.dueDate = req.requestedDue;
                            if (io.id) dueUpdatePromises.push(updateProjectItemOutDueDateInSupabase(io.id, req.requestedDue));
                        }
                    });
                });

                await Promise.all(dueUpdatePromises);
                await Promise.all([refreshRequestsFromSupabase(), refreshProjectsFromSupabase()]);

                showToast(`Extension approved for ${req.itemName}.`, 'success');
                addLog(currentUser.id, 'Approve Extension', `Approved extension for ${req.itemName} requested by ${req.userName}`);
                renderOrders();
            });
        });

        document.querySelectorAll('.deny-req-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const reqId = e.currentTarget.getAttribute('data-id');
                const req = extensionRequests.find(r => r.id === reqId);
                if (!req) return;

                const updated = await updateExtensionRequestInSupabase(req.id, 'Denied');
                if (!updated) {
                    showToast('Failed to deny extension request in database.', 'error');
                    return;
                }

                await refreshRequestsFromSupabase();
                showToast(`Extension denied for ${req.itemName}.`, 'success');
                addLog(currentUser.id, 'Deny Extension', `Denied extension for ${req.itemName} requested by ${req.userName}`);
                renderOrders();
            });
        });

        return;
    }

    if (ordersTabMode === 'flags') {
        const flags = Array.isArray(systemFlags) ? systemFlags.filter(flag => flag.status !== 'Archived') : [];

        // Clear tbody and build DOM-safe rows
        while (tbody.firstChild) {
            tbody.removeChild(tbody.firstChild);
        }

        if (flags.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'text-center text-muted';
            td.textContent = 'No system flags found. Run the SQL migration to enable flag storage.';
            tr.appendChild(td);
            tbody.appendChild(tr);
        } else {
            flags.forEach(flag => {
                const tr = document.createElement('tr');
                
                const statusStyle = flag.status === 'Open'
                    ? 'background:rgba(245,158,11,0.2);color:var(--warning)'
                    : 'background:rgba(255,255,255,0.1);color:var(--text-secondary)';
                
                const flagType = escapeHtml(String(flag.flag_type || 'System'));
                const actorId = escapeHtml(String(flag.actor_user_id || '-'));
                const details = escapeHtml(String(flag.details || '-'));
                const status = escapeHtml(String(flag.status || 'Open'));
                const flagId = escapeHtml(String(flag.id || ''));
                
                // Date column
                const tdDate = document.createElement('td');
                const smallDate = document.createElement('small');
                smallDate.className = 'text-muted';
                smallDate.textContent = new Date(flag.created_at || flag.timestamp || Date.now()).toLocaleDateString();
                tdDate.appendChild(smallDate);
                tr.appendChild(tdDate);
                
                // Flag type column
                const tdType = document.createElement('td');
                tdType.textContent = flagType;
                tr.appendChild(tdType);
                
                // Actor column
                const tdActor = document.createElement('td');
                tdActor.textContent = actorId;
                tr.appendChild(tdActor);
                
                // Details column
                const tdDetails = document.createElement('td');
                tdDetails.textContent = details;
                tr.appendChild(tdDetails);
                
                // Status column
                const tdStatus = document.createElement('td');
                const statusBadge = document.createElement('span');
                statusBadge.className = 'badge';
                statusBadge.style.cssText = statusStyle;
                statusBadge.textContent = status;
                tdStatus.appendChild(statusBadge);
                tr.appendChild(tdStatus);
                
                // Actions column
                const tdActions = document.createElement('td');
                if (currentUser.role !== 'student') {
                    const resolveBtn = document.createElement('button');
                    resolveBtn.className = 'btn btn-secondary text-sm resolve-flag-btn';
                    resolveBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;';
                    resolveBtn.textContent = 'Resolve';
                    resolveBtn.setAttribute('data-id', flagId);
                    tdActions.appendChild(resolveBtn);
                } else {
                    tdActions.textContent = '-';
                }
                tr.appendChild(tdActions);
                
                // Spacer columns
                const tdSpacer1 = document.createElement('td');
                tdSpacer1.textContent = '';
                tr.appendChild(tdSpacer1);
                
                const tdSpacer2 = document.createElement('td');
                tdSpacer2.textContent = '';
                tr.appendChild(tdSpacer2);
                
                tbody.appendChild(tr);
            });
        }

        document.querySelectorAll('.resolve-flag-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const flagId = e.currentTarget.getAttribute('data-id');
                const updated = await updateSystemFlagStatusInSupabase(flagId, 'Archived');
                if (!updated) {
                    showToast('Failed to archive flag in database.', 'error');
                    return;
                }
                await refreshRequestsFromSupabase();
                addLog(currentUser.id, 'Archive Flag', `Archived system flag ${flagId}`);
                showToast('System flag archived.', 'success');
                renderOrders();
            });
        });

        return;
    }

    const selectedStatus = filter?.value || 'all';
    const source = currentUser.role === 'student'
        ? orderRequests.filter(r => r.requestedByUserId === currentUser.id)
        : orderRequests;

    const rows = selectedStatus === 'all'
        ? source
        : source.filter(r => r.status === selectedStatus);

    // Clear tbody and build DOM-safe rows
    while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
    }

    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.className = 'text-center text-muted';
        td.textContent = 'No order requests found.';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            
            const statusStyle = r.status === 'Approved' || r.status === 'Ordered'
                ? 'background:rgba(16,185,129,0.2);color:var(--success)'
                : r.status === 'Denied'
                    ? 'background:rgba(239,68,68,0.2);color:var(--danger)'
                    : 'background:rgba(245,158,11,0.2);color:var(--warning)';

            const canModerate = currentUser.role !== 'student' && r.status === 'Pending';
            const parsed = parseOrderJustification(r.justification);
            const formData = parsed.formData || {};
            const priorityLevel = formData.priorityLevel || 'Medium';
            const estimatedTotalCost = formData.estimatedTotalCost;
            const formattedTotalCost = typeof estimatedTotalCost === 'number'
                ? `$${estimatedTotalCost.toFixed(2)}`
                : '-';
            const requesterLabel = escapeHtml(String(r.requestedByName || r.requestedByUserId || '-'));
            const itemLabel = escapeHtml(String(r.itemName || '-'));
            const priorityLabel = escapeHtml(String(priorityLevel || '-'));
            const statusLabel = escapeHtml(String(r.status || '-'));
            const requestId = escapeHtml(String(r.id || ''));
            
            // Date column
            const tdDate = document.createElement('td');
            const smallDate = document.createElement('small');
            smallDate.className = 'text-muted';
            smallDate.textContent = new Date(r.timestamp).toLocaleDateString();
            tdDate.appendChild(smallDate);
            tr.appendChild(tdDate);
            
            // Requester column
            const tdRequester = document.createElement('td');
            tdRequester.textContent = requesterLabel;
            tr.appendChild(tdRequester);
            
            // Item column
            const tdItem = document.createElement('td');
            const strongItem = document.createElement('strong');
            strongItem.textContent = itemLabel;
            tdItem.appendChild(strongItem);
            tr.appendChild(tdItem);
            
            // Quantity column
            const tdQty = document.createElement('td');
            tdQty.textContent = String(r.quantity || 1);
            tr.appendChild(tdQty);
            
            // Priority column
            const tdPriority = document.createElement('td');
            tdPriority.textContent = priorityLabel;
            tr.appendChild(tdPriority);
            
            // Cost column
            const tdCost = document.createElement('td');
            tdCost.textContent = formattedTotalCost;
            tr.appendChild(tdCost);
            
            // Status column
            const tdStatus = document.createElement('td');
            const statusBadge = document.createElement('span');
            statusBadge.className = 'badge';
            statusBadge.style.cssText = statusStyle;
            statusBadge.textContent = statusLabel;
            tdStatus.appendChild(statusBadge);
            tr.appendChild(tdStatus);
            
            // Actions column
            const tdActions = document.createElement('td');
            if (canModerate) {
                const approveBtn = document.createElement('button');
                approveBtn.className = 'btn btn-secondary text-sm approve-order-btn';
                approveBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;margin-right:0.25rem;';
                approveBtn.textContent = 'Approve';
                approveBtn.setAttribute('data-id', requestId);
                
                const denyBtn = document.createElement('button');
                denyBtn.className = 'btn btn-danger text-sm deny-order-btn';
                denyBtn.style.cssText = 'padding:0.3rem 0.6rem;font-size:0.75rem;';
                denyBtn.textContent = 'Deny';
                denyBtn.setAttribute('data-id', requestId);
                
                tdActions.appendChild(approveBtn);
                tdActions.appendChild(denyBtn);
            } else {
                tdActions.textContent = '-';
            }
            tr.appendChild(tdActions);
            
            tbody.appendChild(tr);
        });
    }

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

            queueOrderReportEvent('order_status_updated', req, { nextStatus: 'Approved' });
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

            queueOrderReportEvent('order_status_updated', req, { nextStatus: 'Denied' });
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
        const typeLabel = escapeHtml(String(r.type || '-'));
        const fromLabel = escapeHtml(String(r.from || '-'));
        const detailsLabel = escapeHtml(String(r.details || '-'));
        const statusLabel = escapeHtml(String(r.status || '-'));
        const reqId = escapeHtml(String(r.id || ''));
        const reqType = escapeHtml(String(r.sourceArray || ''));
        return `
        <tr>
            <td><small class="text-muted">${new Date(r.timestamp).toLocaleDateString()}</small></td>
            <td><span class="badge" style="background: rgba(139,92,246,0.15); color: var(--accent-primary)">${typeLabel}</span></td>
            <td><strong>${fromLabel}</strong></td>
            <td>${detailsLabel}</td>
            <td><span class="badge" style="${statusStyle}">${statusLabel}</span></td>
            <td>
                ${r.status === 'Pending' ? `
                    ${r.sourceArray === 'extension' ? `
                        <button class="btn btn-secondary text-sm approve-req-btn" data-id="${reqId}" data-type="${reqType}" style="padding:0.3rem 0.6rem;font-size:0.75rem;margin-right:0.25rem;">Approve</button>
                        <button class="btn btn-danger text-sm deny-req-btn" data-id="${reqId}" data-type="${reqType}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">Deny</button>
                    ` : `
                        <button class="btn btn-secondary text-sm resolve-req-btn2" data-id="${reqId}" style="padding:0.3rem 0.6rem;font-size:0.75rem;">Resolve</button>
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
                    showToast('Failed to resolve help request in database.', 'error');
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
                    showToast('Failed to approve extension request in database.', 'error');
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
                    showToast('Failed to deny extension request in database.', 'error');
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
async function openEditItemModal(itemId) {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to edit inventory items.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('editing inventory items');
    if (!authOk) return;

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
                    <label>Storage Location</label>
                    <input type="text" id="edit-item-location" class="form-control" value="${item.location || item.storageLocation || ''}">
                </div>
                <div class="form-group">
                    <label>Brand</label>
                    <input type="text" id="edit-item-brand" class="form-control" value="${item.brand || ''}">
                </div>
            </div>
            <div class="grid-2-col" style="gap:1rem">
                <div class="form-group">
                    <label>Supplier</label>
                    <input type="text" id="edit-item-supplier" class="form-control" value="${item.supplier || ''}">
                </div>
                <div class="form-group">
                    <label>Image Link</label>
                    <input type="url" id="edit-item-image-link" class="form-control" value="${item.image_link || item.imageLink || ''}">
                </div>
            </div>
            <div class="form-group">
                <label>Supplier Product Listing Link</label>
                <input type="url" id="edit-item-supplier-link" class="form-control" value="${item.supplier_listing_link || item.supplierListingLink || ''}">
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
                <small class="text-muted" style="display:block;margin-bottom:0.5rem">Control which classes can see this item based on their allowed tags. Untagged items are hidden from students.</small>
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
        const sku = normalizeSkuToken(document.getElementById('edit-item-sku').value);
        const location = document.getElementById('edit-item-location').value.trim();
        const brand = document.getElementById('edit-item-brand').value.trim();
        const supplier = document.getElementById('edit-item-supplier').value.trim();
        const imageLink = document.getElementById('edit-item-image-link').value.trim();
        const supplierListingLink = document.getElementById('edit-item-supplier-link').value.trim();
        const stock = parseInt(document.getElementById('edit-item-stock').value) || 0;
        const threshold = parseInt(document.getElementById('edit-item-threshold').value) || 0;
        const selectedTags = Array.from(document.querySelectorAll('.edit-item-tag-cb:checked')).map(cb => cb.value);

        if (name) {
            if (!sku) {
                showToast('SKU/barcode cannot be blank.', 'error');
                return;
            }

            if (isSkuInUse(sku, itemId)) {
                showToast('SKU/barcode already exists. Please use a unique value.', 'error');
                return;
            }

            const updated = await updateItemInSupabase(itemId, {
                name,
                category,
                sku,
                location,
                storageLocation: location,
                brand,
                supplier,
                image_link: imageLink || null,
                supplier_listing_link: supplierListingLink || null,
                stock,
                threshold
            });
            if (!updated) {
                showToast('Failed to update item in database.', 'error');
                return;
            }

            const tagsUpdated = await setItemVisibilityTagsInSupabase(itemId, selectedTags);
            if (!tagsUpdated) {
                showToast('Item updated, but visibility tags failed to save.', 'warning');
            }

            await refreshInventoryFromSupabase();

            addLog(currentUser.id, 'Barcode Updated', `Barcode ${sku} confirmed for ${name} (${itemId}).`);
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
document.getElementById('bulk-import-items-btn')?.addEventListener('click', async () => {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to bulk import items.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('bulk importing items');
    if (!authOk) return;

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
document.getElementById('manage-categories-btn')?.addEventListener('click', async () => {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to manage categories.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('managing categories');
    if (!authOk) return;

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
                    showToast('Failed to add category in database.', 'error');
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
                        showToast('Failed to rename category in database.', 'error');
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
                        showToast('Failed to delete category in database.', 'error');
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
document.getElementById('manage-visibility-tags-btn')?.addEventListener('click', async () => {
    if (currentUser?.role === 'student') {
        showToast('You do not have permission to manage visibility tags.', 'error');
        return;
    }

    const authOk = await ensurePrivilegedActionAuth('managing visibility tags');
    if (!authOk) return;

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
                <p class="text-secondary mb-4" style="font-size:0.85rem">Visibility tags are applied to items and allowed on classes. A student sees a tagged item only if their class allows that tag. Items with <em>no tags</em> are hidden from students.</p>
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
                    showToast('Failed to add visibility tag in database.', 'error');
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
                        showToast('Failed to rename visibility tag in database.', 'error');
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
                        showToast('Failed to delete visibility tag in database.', 'error');
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
    pinHash: null,           // null = unset; teacher/developer must configure first
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
    if (!debugConfig.pinHash) {
        if (!userCanPerformPrivilegedActions()) {
            showToast('Debug menu not configured. Log in as teacher or developer to set the PIN.', 'error');
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
            <p class="text-secondary mb-4">No debug PIN is set. As a teacher or developer you can create one now.</p>
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
    document.getElementById('dbg-set-pin-btn')?.addEventListener('click', async () => {
        const p1 = document.getElementById('dbg-pin-new').value.trim();
        const p2 = document.getElementById('dbg-pin-confirm').value.trim();
        if (!/^\d{4,8}$/.test(p1)) { showToast('PIN must be 4–8 digits.', 'error'); return; }
        if (p1 !== p2) { showToast('PINs do not match.', 'error'); return; }

        const pinHash = await hashDebugPin(p1);
        if (!pinHash) {
            showToast('Failed to generate PIN hash.', 'error');
            return;
        }

        if (hasStaffPasswordHashConflict(pinHash)) {
            showToast('Debug PIN cannot match a teacher/developer authentication password.', 'error');
            return;
        }

        debugConfig.pinHash = pinHash;
        try {
            localStorage.setItem('debugMenuPinHash', pinHash);
        } catch {
            // Ignore storage failures.
        }

        const saved = await saveDebugPinHashToSupabase(pinHash);
        if (!saved) {
            showToast('Debug PIN saved for this device, but server sync failed.', 'warning');
        }

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
    const tryPin = async () => {
        const val = (document.getElementById('dbg-pin-input')?.value || '').trim();
        _pinAttempts++;
        const pinHash = await hashDebugPin(val);
        if (pinHash && pinHash === debugConfig.pinHash) {
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
    zone.style.cssText = 'position:fixed;bottom:0;left:0;width:64px;height:64px;z-index:950;-webkit-tap-highlight-color:transparent;user-select:none;pointer-events:all;';
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
let kioskUnavailableDescriptionOverride = '';

function getKioskLockScreen(screenKey) {
    return KIOSK_LOCK_SCREENS[screenKey] || KIOSK_LOCK_SCREENS.systemLocked;
}

function getKioskLockMarkup(screenKey) {
    const screen = getKioskLockScreen(screenKey);
    const description = screenKey === 'kioskUnavailable' && kioskUnavailableDescriptionOverride
        ? kioskUnavailableDescriptionOverride
        : screen.description;
    return `<div class="kiosk-lock-card" style="text-align:center;">
        <i class="ph ph-${screen.icon} kiosk-lock-icon"></i>
        <h2 class="kiosk-lock-title">${screen.title}</h2>
        <p class="kiosk-lock-description">${description}</p>
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
    document.getElementById('kiosk-preview-lock')?.addEventListener('click', async () => {
        const chosen = KIOSK_LOCK_SCREEN_ORDER[kioskPreviewState.activeIndex] || 'systemLocked';
        debugConfig.kioskLockScreen = chosen;
        closeKioskLockPreview();
        await applyKioskLock(true, chosen, { syncRemote: true });
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

async function applyKioskLock(lock, screenKey = debugConfig.kioskLockScreen || 'systemLocked', options = {}) {
    const syncRemote = options.syncRemote === true;
    const customDescription = String(options.customDescription || '').trim();
    debugConfig.kioskLocked = lock;
    debugConfig.kioskLockScreen = Object.keys(KIOSK_LOCK_SCREENS).includes(screenKey)
        ? screenKey
        : 'systemLocked';
    kioskLiveStatus.lastKnownLockState = !!lock;
    kioskLiveStatus.lastKnownLockScreen = debugConfig.kioskLockScreen;
    kioskLiveStatus.lastSyncAt = new Date().toISOString();

    if (lock && debugConfig.kioskLockScreen === 'kioskUnavailable' && customDescription) {
        kioskUnavailableDescriptionOverride = customDescription;
    } else if (!lock || debugConfig.kioskLockScreen !== 'kioskUnavailable') {
        kioskUnavailableDescriptionOverride = '';
    }

    let overlay = document.getElementById('kiosk-lock-overlay');

    const renderOverlay = () => {
        overlay.innerHTML = `${getKioskLockMarkup(debugConfig.kioskLockScreen)}`;
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

    if (syncRemote) {
        await syncKioskLockStateToSupabase(lock, debugConfig.kioskLockScreen);
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
    document.getElementById('dbg-kiosk')?.addEventListener('click', async () => {
        const locking = !debugConfig.kioskLocked;
        const chosen = debugConfig.kioskLockScreen || 'systemLocked';
        await applyKioskLock(locking, chosen, { syncRemote: true });
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
            <small class="text-muted" style="display:block;margin-top:0.4rem">Only teacher/developer accounts can change the PIN.</small>
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
        if (!userCanPerformPrivilegedActions()) {
            showToast('Only teacher/developer accounts can change the debug PIN.', 'error'); return;
        }
        debugConfig.pinHash = null;
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

