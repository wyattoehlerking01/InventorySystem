// Nexus Inventory System - Application Logic

/* =======================================
   STATE & INITIALIZATION
   ======================================= */
let currentUser = null;

const envConfig = window.APP_ENV || {};
const appVersion = envConfig.APP_VERSION || 'PRE-RELEASE';

const defaultDuePolicy = {
    defaultSignoutMinutes: 80,
    classPeriodMinutes: 50,
    periodRanges: [
        { start: '08:00', end: '08:55', returnClassPeriods: 2 }
    ]
};

let signoutPolicy = {
    defaultSignoutMinutes: defaultDuePolicy.defaultSignoutMinutes,
    classPeriodMinutes: defaultDuePolicy.classPeriodMinutes,
    periodRanges: defaultDuePolicy.periodRanges.map(range => ({ ...range }))
};

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

// DOM Elements - Pages
const pages = document.querySelectorAll('.page');

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

function getMatchingPolicyRange(date, policy) {
    const currentMinutes = (date.getHours() * 60) + date.getMinutes();
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

function formatPeriodRangesForInput(periodRanges) {
    return periodRanges.map(range => `${range.start}-${range.end}=${range.returnClassPeriods}`).join('\n');
}

function parsePeriodRangesFromInput(rawText) {
    const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
    const parsedRanges = [];

    lines.forEach(line => {
        const [timePart, periodsPart] = line.split('=');
        if (!timePart || !periodsPart) return;

        const [start, end] = timePart.split('-').map(part => part.trim());
        const returnClassPeriods = Math.max(1, parseInt(periodsPart.trim(), 10) || 1);
        if (parseTimeToMinutes(start) === null || parseTimeToMinutes(end) === null) return;

        parsedRanges.push({ start, end, returnClassPeriods });
    });

    return parsedRanges;
}

function getStudentClassForUser(userId) {
    return studentClasses.find(c => c.students.includes(userId));
}

function getVisibleItemIdsForClass(cls) {
    if (!cls) return [];
    if (Array.isArray(cls.visibleItemIds)) return cls.visibleItemIds;
    return inventoryItems.map(item => item.id);
}

function getVisibleItemCountForClass(cls) {
    return getVisibleItemIdsForClass(cls).length;
}

function canUserSeeItem(user, item) {
    if (!user) return false;
    if (user.role !== 'student') return true;

    const cls = getStudentClassForUser(user.id);
    if (!cls) return false;

    // Class-level item visibility is owned by the Classes tab.
    return getVisibleItemIdsForClass(cls).includes(item.id);
}

function applyVersionBadges() {
    const loginVersionEl = document.getElementById('app-version-login');
    const sidebarVersionEl = document.getElementById('app-version-sidebar');
    if (loginVersionEl) loginVersionEl.textContent = appVersion;
    if (sidebarVersionEl) sidebarVersionEl.textContent = appVersion;
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
    const projectId = document.getElementById('basket-project-select').value;
    const project = projectId ? projects.find(p => p.id === projectId) : getOrCreatePersonalProject(currentUser.id);

    inventoryBasket.forEach(basketItem => {
        const item = inventoryItems.find(i => i.id === basketItem.id);
        if (item) {
            item.stock -= basketItem.qty;

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

            if (project.id.startsWith('PERS-')) {
                addLog(currentUser.id, 'Personal Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} to self`);
            } else {
                addLog(currentUser.id, 'Project Sign-out', `Bulk signed out ${basketItem.qty}x ${item.name} for project ${project.name}`);
            }
        }
    });

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
document.getElementById('checkout-basket-btn')?.addEventListener('click', checkoutBasket);

// Init application
document.addEventListener('DOMContentLoaded', () => {
    applyVersionBadges();

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

submitHelpBtn?.addEventListener('click', () => {
    const name = document.getElementById('help-name').value.trim();
    const email = document.getElementById('help-email').value.trim();
    const desc = document.getElementById('help-desc').value.trim();

    if (!name || !desc) {
        showToast('Name and issue description are required.', 'error');
        return;
    }

    helpRequests.unshift({
        id: generateId('REQ'),
        name: name,
        email: email,
        description: desc,
        status: 'Pending',
        timestamp: new Date().toISOString()
    });

    showToast('Your request has been submitted. Support will contact you shortly.', 'success');
    document.getElementById('help-name').value = '';
    document.getElementById('help-email').value = '';
    document.getElementById('help-desc').value = '';
    backToLoginBtn.click();
});

barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const id = barcodeInput.value.trim().toUpperCase();
        barcodeInput.value = '';

        const user = mockUsers.find(u => u.id === id);
        if (user) {
            if (user.status === 'Suspended') {
                showToast('Your account is suspended. Please contact a teacher.', 'error');
                return;
            }
            login(user);
        } else {
            showToast('Invalid barcode scanned.', 'error');
        }
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

function login(user) {
    currentUser = user;
    startCountdown();

    // Update Profile UI
    const profileAvatar = document.getElementById('user-avatar');
    if (profileAvatar) profileAvatar.innerHTML = getRoleIcon(user.role);

    userNameEl.textContent = user.name;
    userRoleEl.textContent = user.role;

    // Student Class Visibility
    const userClassEl = document.getElementById('user-class');
    if (user.role === 'student') {
        const userClass = studentClasses.find(c => c.students.includes(user.id));
        if (userClassEl) {
            userClassEl.textContent = userClass ? userClass.name : 'No Class Assigned';
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
        document.getElementById('manage-categories-btn')?.classList.add('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.add('hidden');
    } else {
        navLogs.classList.remove('hidden');
        navUsers.classList.remove('hidden');
        navClasses.classList.remove('hidden');
        navRequests?.classList.remove('hidden');
        document.getElementById('manage-categories-btn')?.classList.remove('hidden');
        document.getElementById('bulk-import-items-btn')?.classList.remove('hidden');
    }

    // Role-based Add Item / Create Project UI logic
    const addItemBtn = document.getElementById('add-item-btn');
    const createProjectBtn = document.getElementById('create-project-btn');

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

    showToast(`Welcome, ${user.name}`);

    // Switch Views
    loginView.classList.remove('active');
    setTimeout(() => {
        loginView.classList.add('hidden');
        mainView.classList.remove('hidden');
        setTimeout(() => mainView.classList.add('active'), 50);

        // Load initial Dashboard
        loadDashboard();
        switchPage('dashboard', 'Dashboard');
    }, 300);
}

function logout(message = 'Logged out successfully') {
    currentUser = null;
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

logoutBtn.addEventListener('click', () => logout());

/* =======================================
   ROUTING
   ======================================= */
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        const title = btn.textContent.trim();

        // UI Selection
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        switchPage(target, title);
    });
});

function switchPage(targetId, title) {
    pageTitle.textContent = title;

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
    if (targetId === 'requests') renderRequests();
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

    if (currentUser.role === 'student') {
        // Student Dashboard view
        if (tabbedWidget) tabbedWidget.parentElement.style.display = 'none';
        if (studentWidgets) studentWidgets.style.display = '';

        const myProjects = projects.filter(p => p.ownerId === currentUser.id || p.collaborators.includes(currentUser.id));
        let itemsOutCount = 0;
        let myItemsOut = [];

        myProjects.forEach(p => {
            p.itemsOut.forEach(outItem => {
                itemsOutCount += outItem.quantity;
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
                    </div>
                </li>`;
            }).join('');

        // Bind extension request buttons
        document.querySelectorAll('.request-extension-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const itemId = e.currentTarget.getAttribute('data-item-id');
                const projectName = e.currentTarget.getAttribute('data-project');
                const currentDue = e.currentTarget.getAttribute('data-due');
                const item = inventoryItems.find(i => i.id === itemId);

                extensionRequests.push({
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
                });

                showToast(`Extension requested for ${item ? item.name : 'item'}. An admin will review it.`, 'success');
                addLog(currentUser.id, 'Extension Request', `Requested extension for ${item ? item.name : itemId} in ${projectName}`);
            });
        });

        list2.innerHTML = myProjects.length === 0 ? '<p class="text-muted">You are not in any projects.</p>' :
            myProjects.slice(0, 5).map(p => `
            <li class="activity-item">
                <div class="timestamp">${p.status}</div>
                <div><strong>${p.name}</strong></div>
            </li>
        `).join('');

    } else {
        // Admin/Teacher Dashboard view
        if (tabbedWidget) tabbedWidget.parentElement.style.display = '';
        if (studentWidgets) studentWidgets.style.display = 'none';

        const totalItems = inventoryItems.length;
        const lowStockCount = inventoryItems.filter(i => i.stock <= i.threshold).length;
        const totalStock = inventoryItems.reduce((acc, curr) => acc + curr.stock, 0);

        // Count items signed out across all projects
        let totalItemsOut = 0;
        projects.forEach(p => {
            p.itemsOut.forEach(io => { totalItemsOut += io.quantity; });
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
        `;

        // Setup tabbed widget
        function renderAdminTab(tab) {
            const tabContent = document.getElementById('widget-tab-content');
            if (!tabContent) return;

            if (tab === 'lowstock') {
                const lowStockItems = inventoryItems.filter(i => i.stock <= i.threshold).slice(0, 8);
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
                tabContent.innerHTML = `<ul class="activity-list mini">${recentLogs.map(log => `
                    <li class="activity-item">
                        <div class="timestamp">${new Date(log.timestamp).toLocaleString()}</div>
                        <div><span style="font-size:1rem;margin-right:0.3rem">${getRoleIcon(mockUsers.find(u => u.id === log.userId)?.role)}</span><strong>${mockUsers.find(u => u.id === log.userId)?.name || log.userId}</strong> - ${log.action}</div>
                    </li>
                `).join('')}</ul>`;
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
function determineStatus(stock, threshold) {
    if (stock <= 0) return 'Critical';
    if (stock <= threshold) return 'Low Stock';
    return 'In Stock';
}

function renderInventory(filterStr = 'All') {
    const tbody = document.getElementById('inventory-table-body');
    let filtered = currentUser.role === 'student'
        ? inventoryItems.filter(item => canUserSeeItem(currentUser, item))
        : inventoryItems;

    if (filterStr !== 'All') {
        filtered = inventoryItems.filter(i => i.category === filterStr);
        if (currentUser.role === 'student') {
            filtered = filtered.filter(item => canUserSeeItem(currentUser, item));
        }
    }

    tbody.innerHTML = filtered.map(item => {
        const currentStatus = determineStatus(item.stock, item.threshold);
        const statusClass = currentStatus === 'In Stock' ? 'status-instock' : currentStatus === 'Low Stock' ? 'status-lowstock' : 'status-critical';
        const canSignOut = currentUser.perms?.canSignOut !== false;

        return `
            <tr>
                <td><input type="checkbox" class="item-select-cb" data-id="${item.id}"></td>
                <td>
                    <div class="font-bold">${item.name}</div>
                    <small class="text-xs text-muted">ID: ${item.id}</small>
                </td>
                <td>${item.category}</td>
                <td class="text-muted font-mono" style="font-size:0.8rem">${item.sku}</td>
                <td>${item.stock}</td>
                <td><span class="status-badge ${statusClass}">${currentStatus}</span></td>
                <td>
                    <div class="flex gap-2">
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

/* =======================================
   PROJECTS & SIGNOUT LOGIC
   ======================================= */
function canCurrentUserReturnProjectItem(project) {
    if (!currentUser) return false;
    if (currentUser.role !== 'student') return true;
    return project.ownerId === currentUser.id || project.collaborators.includes(currentUser.id);
}

function findSignoutIndex(project, signoutId) {
    return project.itemsOut.findIndex(io => (io.id || `${io.itemId}-${io.signoutDate}-${io.quantity}`) === signoutId);
}

function returnProjectItem(projectId, signoutId) {
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

    if (item) item.stock += io.quantity;
    project.itemsOut.splice(ioIndex, 1);

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
    renderDashboard();
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
            <div class="project-card glass-panel flex-col">
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
                    <button class="btn btn-secondary text-sm edit-proj-btn" data-id="${proj.id}">
                        <i class="ph ph-pencil-simple"></i> Edit
                    </button>
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
            showToast(`Project details for ${id} clicked.`);
        });
    });

    document.querySelectorAll('.return-project-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const projectId = e.currentTarget.getAttribute('data-project-id');
            const signoutId = e.currentTarget.getAttribute('data-signout-id');
            returnProjectItem(projectId, signoutId);
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

    document.getElementById('confirm-signout').addEventListener('click', () => {
        const projId = document.getElementById('so-project').value;
        const qty = parseInt(document.getElementById('so-qty').value);

        if (qty > 0 && qty <= item.stock) {
            // Update stock
            item.stock -= qty;

            // Update Project
            let project;
            if (projId === 'personal') {
                // Ensure personal project exists for this user
                project = getOrCreatePersonalProject(currentUser.id);
            } else {
                project = projects.find(p => p.id === projId);
            }

            project.itemsOut.push({
                id: generateId('OUT'),
                itemId: item.id,
                quantity: qty,
                signoutDate: new Date().toISOString(),
                dueDate: calculateDueDate(new Date(), currentUser),
                assignedToUserId: project.ownerId,
                signedOutByUserId: currentUser.id
            });

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
let studentClasses = [
    {
        id: 'CLS-001',
        name: 'Intro to Robotics (Fall)',
        students: ['STU-123', 'STU-999'],
        visibleItemIds: ['ITM-001', 'ITM-004'],
        duePolicy: {
            defaultSignoutMinutes: 80,
            classPeriodMinutes: 50,
            periodRanges: [
                { start: '08:00', end: '08:55', returnClassPeriods: 2 }
            ]
        },
        defaultPermissions: { canCreateProjects: false, canJoinProjects: true, canSignOut: true }
    },
    {
        id: 'CLS-002',
        name: 'Advanced Electronics',
        students: ['STU-555'],
        visibleItemIds: inventoryItems.map(item => item.id),
        duePolicy: {
            defaultSignoutMinutes: 80,
            classPeriodMinutes: 50,
            periodRanges: [
                { start: '08:00', end: '08:55', returnClassPeriods: 3 },
                { start: '09:00', end: '09:50', returnClassPeriods: 2 }
            ]
        },
        defaultPermissions: { canCreateProjects: true, canJoinProjects: true, canSignOut: true }
    }
];

function renderClasses() {
    const container = document.getElementById('classes-container');
    if (currentUser.role === 'student') return;

    container.innerHTML = studentClasses.map(cls => {
        const studentCount = cls.students.length;
        const visibleItemCount = getVisibleItemCountForClass(cls);
        const classDuePolicy = normalizeDuePolicy(cls.duePolicy);
        const teacher = mockUsers.find(u => u.id === cls.teacherId);

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
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const cls = studentClasses.find(c => c.id === id);
            if (confirm(`Are you sure you want to delete ${cls.name}? This cannot be undone.`)) {
                studentClasses = studentClasses.filter(c => c.id !== id);
                showToast(`Class ${cls.name} deleted.`, 'success');
                addLog(currentUser.id, 'Delete Class', `Deleted student class: ${cls.name}`);
                renderClasses();
            }
        });
    });
}

function openEditClassModal(classId) {
    const cls = studentClasses.find(c => c.id === classId);
    if (!cls) return;

    const availableStudents = mockUsers.filter(u => u.role === 'student');
    const studentOptions = availableStudents.map(s =>
        `<div style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${s.id}" class="edit-class-student-checkbox" ${cls.students.includes(s.id) ? 'checked' : ''}>
                ${s.name} (${s.id})
            </label>
        </div>`
    ).join('');

    const visibleItemIds = getVisibleItemIdsForClass(cls);
    const classDuePolicy = normalizeDuePolicy(cls.duePolicy);
    const itemOptions = inventoryItems.map(item =>
        `<div style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${item.id}" class="edit-class-item-checkbox" ${visibleItemIds.includes(item.id) ? 'checked' : ''}>
                ${item.name} (${item.id})
            </label>
        </div>`
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
                <div class="glass-panel" style="padding:1rem; max-height:200px; overflow-y:auto">
                    ${studentOptions || '<p class="text-muted">No students available.</p>'}
                </div>
            </div>
            <div class="form-group">
                <label>Visible Inventory Items</label>
                <div class="glass-panel" style="padding:1rem; max-height:220px; overflow-y:auto">
                    ${itemOptions || '<p class="text-muted">No items available.</p>'}
                </div>
            </div>
            <div class="form-group">
                <label>Default Return Window (minutes)</label>
                <input type="number" id="edit-class-default-due" class="form-control" min="1" value="${classDuePolicy.defaultSignoutMinutes}">
            </div>
            <div class="form-group">
                <label>Minutes Per Class Period</label>
                <input type="number" id="edit-class-period-mins" class="form-control" min="1" value="${classDuePolicy.classPeriodMinutes}">
            </div>
            <div class="form-group">
                <label>Time Ranges (one per line: HH:MM-HH:MM=Periods)</label>
                <textarea id="edit-class-period-ranges" class="form-control" rows="4" placeholder="08:00-08:55=2">${formatPeriodRangesForInput(classDuePolicy.periodRanges)}</textarea>
                <small class="text-muted">When sign-out time falls in a range, due date uses periods x minutes per period.</small>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-class">Save Changes</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-edit-class').addEventListener('click', () => {
        const name = document.getElementById('edit-class-name').value.trim();
        const checkedStudents = Array.from(document.querySelectorAll('.edit-class-student-checkbox:checked')).map(cb => cb.value);
        const checkedItems = Array.from(document.querySelectorAll('.edit-class-item-checkbox:checked')).map(cb => cb.value);
        const defaultDueMinutes = Math.max(1, parseInt(document.getElementById('edit-class-default-due').value, 10) || 80);
        const classPeriodMinutes = Math.max(1, parseInt(document.getElementById('edit-class-period-mins').value, 10) || 50);
        const parsedRanges = parsePeriodRangesFromInput(document.getElementById('edit-class-period-ranges').value || '');

        if (name) {
            cls.name = name;
            cls.students = checkedStudents;
            cls.visibleItemIds = checkedItems;
            cls.duePolicy = normalizeDuePolicy({
                defaultSignoutMinutes: defaultDueMinutes,
                classPeriodMinutes: classPeriodMinutes,
                periodRanges: parsedRanges
            });
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
    // Only show students
    const availableStudents = mockUsers.filter(u => u.role === 'student');
    const studentOptions = availableStudents.map(s =>
        `<div style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${s.id}" class="student-checkbox">
                ${s.name} (${s.id})
            </label>
        </div>`
    ).join('');

    const itemOptions = inventoryItems.map(item =>
        `<div style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${item.id}" class="class-item-checkbox" checked>
                ${item.name} (${item.id})
            </label>
        </div>`
    ).join('');

    const defaultRangesText = formatPeriodRangesForInput(defaultDuePolicy.periodRanges);

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
                <div class="glass-panel" style="padding:1rem; max-height:200px; overflow-y:auto">
                    ${studentOptions}
                </div>
            </div>
            <div class="form-group">
                <label>Visible Inventory Items</label>
                <div class="glass-panel" style="padding:1rem; max-height:220px; overflow-y:auto">
                    ${itemOptions}
                </div>
            </div>
            <div class="form-group">
                <label>Default Return Window (minutes)</label>
                <input type="number" id="add-class-default-due" class="form-control" min="1" value="${defaultDuePolicy.defaultSignoutMinutes}">
            </div>
            <div class="form-group">
                <label>Minutes Per Class Period</label>
                <input type="number" id="add-class-period-mins" class="form-control" min="1" value="${defaultDuePolicy.classPeriodMinutes}">
            </div>
            <div class="form-group">
                <label>Time Ranges (one per line: HH:MM-HH:MM=Periods)</label>
                <textarea id="add-class-period-ranges" class="form-control" rows="4" placeholder="08:00-08:55=2">${defaultRangesText}</textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-class">Create Class</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-add-class').addEventListener('click', () => {
        const name = document.getElementById('add-class-name').value.trim();
        const checkedStudents = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => cb.value);
        const checkedItems = Array.from(document.querySelectorAll('.class-item-checkbox:checked')).map(cb => cb.value);
        const defaultDueMinutes = Math.max(1, parseInt(document.getElementById('add-class-default-due').value, 10) || 80);
        const classPeriodMinutes = Math.max(1, parseInt(document.getElementById('add-class-period-mins').value, 10) || 50);
        const parsedRanges = parsePeriodRangesFromInput(document.getElementById('add-class-period-ranges').value || '');

        if (name) {
            studentClasses.unshift({
                id: generateId('CLS'),
                name: name,
                teacherId: currentUser.id,
                students: checkedStudents,
                visibleItemIds: checkedItems,
                duePolicy: normalizeDuePolicy({
                    defaultSignoutMinutes: defaultDueMinutes,
                    classPeriodMinutes: classPeriodMinutes,
                    periodRanges: parsedRanges
                })
            });
            showToast(`Class ${name} created with ${checkedStudents.length} students.`, 'success');
            addLog(currentUser.id, 'Create Class', `Created class ${name} with ${checkedStudents.length} students.`);
            closeModal();
            if (document.getElementById('page-classes').classList.contains('active')) {
                renderClasses();
            }
        } else {
            showToast('Class name is required', 'error');
        }
    });
});


/* =======================================
   LOGS LOGIC
   ======================================= */
function renderLogs() {
    const tbody = document.getElementById('logs-table-body');
    if (currentUser.role === 'student') return; // Double check protection

    tbody.innerHTML = activityLogs.map(log => {
        const trUser = mockUsers.find(u => u.id === log.userId);
        return `
            <tr>
                <td class="text-muted"><small>${new Date(log.timestamp).toLocaleString()}</small></td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem">
                        <span style="font-size:1.2rem">${getRoleIcon(trUser?.role)}</span>
                        ${trUser?.name || log.userId}
                    </div>
                </td>
                <td><strong>${log.action}</strong></td>
                <td>${log.details}</td>
            </tr>
        `;
    }).join('');
}


/* =======================================
   USERS LOGIC
   ======================================= */
function renderUsers() {
    const tbody = document.getElementById('users-table-body');
    if (currentUser.role === 'student' || !tbody) return;

    tbody.innerHTML = mockUsers.map(user => {
        const isSuspended = user.status === 'Suspended';
        const canEdit = !(currentUser.role === 'teacher' && user.role === 'developer');

        return `
            <tr class="${isSuspended ? 'opacity-60' : ''}">
                <td>
                    ${user.role === 'student' ? `<input type="checkbox" class="user-select-cb" data-id="${user.id}">` : '<span style="width:16px;display:inline-block"></span>'}
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
                    </div>
                </td>
                <td>
                    <span class="status-indicator ${user.status === 'Active' ? 'bg-success' : 'bg-danger'}"></span>
                    ${user.status}
                </td>
                <td>
                    <div class="flex gap-2 user-actions">
                        ${canEdit ? `<button class="btn btn-secondary btn-sm edit-user-btn" data-id="${user.id}" title="Edit User"><i class="ph ph-pencil"></i></button>` : `<i class="ph ph-lock text-muted" title="Developer locked"></i>`}
                        ${user.role === 'student' ? `
                            <button class="btn btn-secondary btn-sm suspend-user-btn" data-id="${user.id}" title="${isSuspended ? 'Reactivate' : 'Suspend'}">
                                <i class="ph ${isSuspended ? 'ph-user-check' : 'ph-user-minus'}"></i>
                            </button>
                            <button class="btn btn-danger btn-sm delete-user-btn" data-id="${user.id}" title="Delete"><i class="ph ph-trash"></i></button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    document.querySelectorAll('.suspend-user-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const user = mockUsers.find(u => u.id === id);
            if (!user) return;

            const isSuspending = user.status !== 'Suspended';
            if (isSuspending) {
                if (!confirm(`Are you sure you want to suspend ${user.name}? This will block their login access.`)) return;
            } else {
                if (!confirm(`Are you sure you want to reactivate ${user.name}?`)) return;
            }

            user.status = isSuspending ? 'Suspended' : 'Active';
            showToast(`${user.name} is now ${user.status}`, 'info');
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
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const user = mockUsers.find(u => u.id === id);
            if (!user) return;

            if (confirm(`CRITICAL: Are you sure you want to delete ${user.name}? This action is permanent.`)) {
                const idx = mockUsers.findIndex(u => u.id === id);
                mockUsers.splice(idx, 1);
                showToast(`${user.name} deleted.`);
                addLog(currentUser.id, 'Delete User', `Deleted user account: ${user.name} (${user.id})`);
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
                <input type="text" id="user-id" class="form-control" placeholder="e.g. STU-999" ${isEdit ? 'disabled' : ''} value="${isEdit ? userToEdit.id : ''}">
                ${isEdit ? '<small class="text-muted">User ID cannot be changed once created.</small>' : ''}
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
                <div style="display:flex; flex-direction:column; gap:0.5rem; margin-top:0.5rem">
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

    document.getElementById('confirm-user-btn').addEventListener('click', () => {
        const id = document.getElementById('user-id').value.trim().toUpperCase();
        const name = document.getElementById('user-name-input').value.trim();
        const role = document.getElementById('user-role-input').value;

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

            showToast('User updated successfully.', 'success');
            addLog(currentUser.id, 'Edit User', `Updated user: ${id}`);
        } else {
            if (mockUsers.some(u => u.id === id)) {
                showToast('A user with this ID already exists.', 'error');
                return;
            }
            mockUsers.push({
                id: id,
                name: name,
                role: role,
                perms: perms,
                status: 'Active'
            });

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
        btn.addEventListener('click', (e) => {
            const reqId = e.target.getAttribute('data-id');
            const req = helpRequests.find(r => r.id === reqId);
            if (req) {
                req.status = 'Resolved';
                showToast('Request marked as resolved.', 'success');
                closeModal();
                document.getElementById('view-requests-btn').click(); // refresh modal
            }
        });
    });
});

document.getElementById('bulk-users-btn')?.addEventListener('click', () => {
    const html = `
        <div class="modal-header">
            <h3>Bulk Import Users</h3>
            <button class="close-btn" onclick="closeModal()"><i class="ph ph-x"></i></button>
        </div>
        <div class="modal-body">
            <p class="text-secondary mb-4">Paste comma-separated user data in the format:<br><strong>ID,Name,Role</strong></p>
            <div class="form-group">
                <textarea id="bulk-users-data" class="form-control" rows="6" placeholder="STU-001,Alice Smith,student\nTCH-002,Bob Jones,teacher"></textarea>
            </div>
            <p class="text-sm text-muted">Roles must be 'student', 'teacher', or 'developer'. Existing IDs will be skipped.</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-bulk-btn">Import Users</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-bulk-btn').addEventListener('click', () => {
        const data = document.getElementById('bulk-users-data').value.trim();
        if (!data) {
            showToast('Please enter data to import.', 'error');
            return;
        }

        const lines = data.split('\\n');
        let importCount = 0;
        let skipCount = 0;

        lines.forEach(line => {
            const parts = line.split(',');
            if (parts.length >= 3) {
                const id = parts[0].trim().toUpperCase();
                const name = parts[1].trim();
                const role = parts[2].trim().toLowerCase();

                if (id && name && ['student', 'teacher', 'developer'].includes(role)) {
                    if (!mockUsers.some(u => u.id === id)) {
                        mockUsers.push({
                            id: id,
                            name: name,
                            role: role,
                            status: 'Active'
                        });
                        importCount++;
                    } else {
                        skipCount++;
                    }
                }
            }
        });

        if (importCount > 0) {
            showToast(`Successfully imported ${importCount} users. (${skipCount} skipped)`, 'success');
            addLog(currentUser.id, 'Bulk Import', `Imported ${importCount} users.`);
        } else {
            showToast('No valid new users found to import.', 'error');
        }

        closeModal();
        if (document.getElementById('page-users').classList.contains('active')) {
            renderUsers();
        }
    });
});

document.getElementById('bulk-delete-users-btn')?.addEventListener('click', () => {
    const selectedCbs = Array.from(document.querySelectorAll('.user-select-cb:checked'));
    if (selectedCbs.length === 0) {
        showToast('Please select users to delete using the checkboxes on the left.', 'error');
        return;
    }

    const selectedIds = selectedCbs.map(cb => cb.getAttribute('data-id'));
    const targetUsers = mockUsers.filter(u => selectedIds.includes(u.id) && u.role === 'student');

    if (targetUsers.length === 0) {
        showToast('Only students can be deleted. No students were selected.', 'error');
        return;
    }

    if (confirm(`Are you absolutely sure you want to PERMANENTLY delete ${targetUsers.length} selected student(s)? This cannot be undone.`)) {
        let deleteCount = 0;
        targetUsers.forEach(u => {
            const index = mockUsers.findIndex(user => user.id === u.id);
            if (index > -1) {
                mockUsers.splice(index, 1);
                deleteCount++;
                // cascade delete from classes
                studentClasses.forEach(cls => {
                    cls.students = cls.students.filter(sId => sId !== u.id);
                });
            }
        });

        showToast(`Successfully deleted ${deleteCount} students.`, 'success');
        addLog(currentUser.id, 'Bulk Delete', `Deleted ${deleteCount} students via selection.`);
        renderUsers();
    }
});

document.getElementById('bulk-suspend-users-btn')?.addEventListener('click', () => {
    const selectedCbs = Array.from(document.querySelectorAll('.user-select-cb:checked'));
    if (selectedCbs.length === 0) {
        showToast('Please select users to suspend using the checkboxes on the left.', 'error');
        return;
    }

    const selectedIds = selectedCbs.map(cb => cb.getAttribute('data-id'));
    const targetUsers = mockUsers.filter(u => selectedIds.includes(u.id) && u.role === 'student');

    if (targetUsers.length === 0) {
        showToast('Only students can be suspended. No students were selected.', 'error');
        return;
    }

    const userNames = targetUsers.map(u => u.name).join('\n• ');
    const promptMsg = targetUsers.length === 1
        ? `Are you sure you want to change the suspension status for ${targetUsers[0].name}?`
        : `Are you sure you want to change the suspension status for these ${targetUsers.length} students?\n\n• ${userNames}`;

    if (confirm(promptMsg)) {
        let suspendCount = 0;
        let activateCount = 0;
        targetUsers.forEach(u => {
            if (u.status === 'Suspended') {
                u.status = 'Active';
                activateCount++;
            } else {
                u.status = 'Suspended';
                suspendCount++;
            }
        });

        showToast(`Updated status for ${targetUsers.length} students (${suspendCount} suspended, ${activateCount} activated).`, 'success');
        addLog(currentUser.id, 'Bulk Suspend', `Changed suspension for ${targetUsers.length} students via selection.`);
        renderUsers();
    }
});


/* =======================================
   MODAL & NOTIFICATION HELPERS
   ======================================= */
function openModal(contentHtml) {
    dynamicModal.innerHTML = contentHtml;
    modalContainer.classList.remove('hidden');
}

function closeModal() {
    modalContainer.classList.add('hidden');
    dynamicModal.innerHTML = '';
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
document.getElementById('add-item-btn')?.addEventListener('click', () => {
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
                    <option>Electronics</option>
                    <option>Hardware</option>
                    <option>Consumables</option>
                </select>
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
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-item">Add Item</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-add-item').addEventListener('click', () => {
        const name = document.getElementById('add-name').value.trim();
        const category = document.getElementById('add-category').value;
        const stock = parseInt(document.getElementById('add-stock').value) || 0;
        const threshold = parseInt(document.getElementById('add-threshold').value) || 0;

        if (name) {
            const newItem = {
                id: generateId('ITM'),
                name: name,
                category: category,
                sku: name.substring(0, 3).toUpperCase() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0'),
                stock: stock,
                threshold: threshold
            };
            inventoryItems.push(newItem);
            addLog(currentUser.id, 'Add Item', `Added new inventory item: ${name}(${stock} units)`);
            showToast(`${name} added to inventory.`, 'success');
            closeModal();
            if (document.getElementById('page-inventory').classList.contains('active')) {
                renderInventory();
            }
        } else {
            showToast('Item name is required', 'error');
        }
    });
});

function openEditProjectModal(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Only teachers/devs or the project owner can edit
    if (currentUser.role === 'student' && project.ownerId !== currentUser.id) {
        showToast('You can only edit projects you created.', 'error');
        return;
    }

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
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-proj">Save Changes</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-edit-proj').addEventListener('click', () => {
        const name = document.getElementById('edit-proj-name').value.trim();
        const desc = document.getElementById('edit-proj-desc').value.trim();
        const status = document.getElementById('edit-proj-status').value;

        if (name) {
            project.name = name;
            project.description = desc;
            project.status = status;

            addLog(currentUser.id, 'Edit Project', `Updated project: ${project.name}`);
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
    // Determine students that can be added as collaborators (only those with canJoinProjects perms)
    // and exclude the current user from the list.
    const availableStudents = mockUsers.filter(u => u.role === 'student' && u.id !== currentUser.id && u.perms?.canJoinProjects !== false);

    // Students can add other students to their project
    const studentOptions = availableStudents.map(s =>
        `<div style="margin-bottom:0.5rem">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
                <input type="checkbox" value="${s.id}" class="proj-student-checkbox">
                ${s.name} (${s.id})
            </label>
        </div>`
    ).join('');

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
            <div class="form-group">
                <label>Add Student Collaborators (Optional)</label>
                <div class="glass-panel" style="padding:1rem; max-height:150px; overflow-y:auto">
                    ${studentOptions || '<p class="text-sm text-muted">No available student collaborators.</p>'}
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-add-proj">Create Project</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-add-proj').addEventListener('click', () => {
        const name = document.getElementById('add-proj-name').value.trim();
        const desc = document.getElementById('add-proj-desc').value.trim();
        const collaborators = Array.from(document.querySelectorAll('.proj-student-checkbox:checked')).map(cb => cb.value);

        if (name) {
            projects.unshift({
                id: generateId('PRJ'),
                name: name,
                ownerId: currentUser.id,
                description: desc,
                collaborators: collaborators,
                status: 'Active',
                itemsOut: []
            });
            addLog(currentUser.id, 'Create Project', `Created new project: ${name} with ${collaborators.length} collaborators.`);
            showToast(`Project ${name} created.`, 'success');
            closeModal();
            if (document.getElementById('page-projects').classList.contains('active')) {
                renderProjects();
            }
        }
    });
});

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
        btn.addEventListener('click', (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = helpRequests.find(r => r.id === reqId);
            if (req) {
                req.status = 'Resolved';
                showToast('Help request resolved.', 'success');
                addLog(currentUser.id, 'Resolve Request', `Resolved credential request from ${req.name}`);
                renderRequests();
            }
        });
    });

    // Bind approve/deny for extension requests
    document.querySelectorAll('.approve-req-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = extensionRequests.find(r => r.id === reqId);
            if (req) {
                req.status = 'Approved';
                // Actual date extension: find item in projects and extend the due date
                projects.forEach(p => {
                    p.itemsOut.forEach(io => {
                        if (io.itemId === req.itemId && io.dueDate === req.currentDue) {
                            io.dueDate = req.requestedDue;
                        }
                    });
                });
                showToast(`Extension approved for ${req.itemName}.`, 'success');
                addLog(currentUser.id, 'Approve Extension', `Approved extension for ${req.itemName} requested by ${req.userName}`);
                renderRequests();
            }
        });
    });

    document.querySelectorAll('.deny-req-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const reqId = e.currentTarget.getAttribute('data-id');
            const req = extensionRequests.find(r => r.id === reqId);
            if (req) {
                req.status = 'Denied';
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
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="confirm-edit-item">Save Changes</button>
        </div>
    `;

    openModal(html);

    document.getElementById('confirm-edit-item').addEventListener('click', () => {
        const name = document.getElementById('edit-item-name').value.trim();
        const category = document.getElementById('edit-item-category').value;
        const sku = document.getElementById('edit-item-sku').value.trim();
        const stock = parseInt(document.getElementById('edit-item-stock').value) || 0;
        const threshold = parseInt(document.getElementById('edit-item-threshold').value) || 0;

        if (name) {
            item.name = name;
            item.category = category;
            item.sku = sku;
            item.stock = stock;
            item.threshold = threshold;

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

    document.getElementById('confirm-bulk-items').addEventListener('click', () => {
        const data = document.getElementById('bulk-items-data').value.trim();
        if (!data) {
            showToast('Please enter data to import.', 'error');
            return;
        }

        const lines = data.split('\n');
        let importCount = 0;

        lines.forEach(line => {
            const parts = line.split(',');
            if (parts.length >= 3) {
                const name = parts[0].trim();
                const category = parts[1].trim();
                const sku = parts[2] ? parts[2].trim() : name.substring(0, 3).toUpperCase() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
                const stock = parseInt(parts[3]) || 0;
                const threshold = parseInt(parts[4]) || 5;

                if (name) {
                    inventoryItems.push({
                        id: generateId('ITM'),
                        name: name,
                        category: category,
                        sku: sku,
                        stock: stock,
                        threshold: threshold
                    });
                    importCount++;
                }
            }
        });

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

        document.getElementById('add-category-btn')?.addEventListener('click', () => {
            const name = document.getElementById('new-category-name').value.trim();
            if (name && !categories.includes(name)) {
                categories.push(name);
                showToast(`Category "${name}" added.`, 'success');
                addLog(currentUser.id, 'Manage Categories', `Added category: ${name}`);
                renderCategoryModal();
            } else if (categories.includes(name)) {
                showToast('Category already exists.', 'error');
            }
        });

        document.querySelectorAll('.rename-cat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const oldName = categories[idx];
                const newName = prompt(`Rename "${oldName}" to:`, oldName);
                if (newName && newName.trim() && newName.trim() !== oldName) {
                    // Update items with this category
                    inventoryItems.forEach(item => {
                        if (item.category === oldName) item.category = newName.trim();
                    });
                    categories[idx] = newName.trim();
                    showToast(`Category renamed to "${newName.trim()}".`, 'success');
                    addLog(currentUser.id, 'Manage Categories', `Renamed category: ${oldName} → ${newName.trim()}`);
                    renderCategoryModal();
                }
            });
        });

        document.querySelectorAll('.delete-cat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                const catName = categories[idx];
                if (confirm(`Delete category "${catName}"? Items in this category will become "Uncategorized".`)) {
                    inventoryItems.forEach(item => {
                        if (item.category === catName) item.category = 'Uncategorized';
                    });
                    categories.splice(idx, 1);
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
   UPDATE ADD ITEM TO USE DYNAMIC CATEGORIES
   ======================================= */
const origAddItemBtn = document.getElementById('add-item-btn');
if (origAddItemBtn) {
    // Override the click handler to use dynamic categories
    origAddItemBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        const categoryOptions = categories.map(c => `<option>${c}</option>`).join('');
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
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" id="confirm-add-item-dyn">Add Item</button>
            </div>
        `;

        openModal(html);

        document.getElementById('confirm-add-item-dyn').addEventListener('click', () => {
            const name = document.getElementById('add-name').value.trim();
            const category = document.getElementById('add-category').value;
            const stock = parseInt(document.getElementById('add-stock').value) || 0;
            const threshold = parseInt(document.getElementById('add-threshold').value) || 0;

            if (name) {
                inventoryItems.push({
                    id: generateId('ITM'),
                    name: name,
                    category: category,
                    sku: name.substring(0, 3).toUpperCase() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0'),
                    stock: stock,
                    threshold: threshold
                });
                addLog(currentUser.id, 'Add Item', `Added new inventory item: ${name} (${stock} units)`);
                showToast(`${name} added to inventory.`, 'success');
                closeModal();
                if (document.getElementById('page-inventory').classList.contains('active')) {
                    renderInventory();
                }
            } else {
                showToast('Item name is required', 'error');
            }
        });
    }, true); // Use capture phase to override existing handler
}
