/* =======================================
   SUPABASE CLIENT & INITIALIZATION
   ======================================= */

// Initialize Supabase client
const { SUPABASE_URL, SUPABASE_KEY } = window.APP_ENV;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
let helpRequests = [];
let extensionRequests = [];

/* =======================================
   DATA LOADING FUNCTIONS
   ======================================= */

/**
 * Load all data from Supabase tables
 */
async function loadAllData() {
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
            loadProjectCollaborators(),
            loadProjectItemsOut(),
            loadInventoryItemVisibility(),
            loadStudentClasses()
        ]);
        console.log('All data loaded from Supabase successfully.');
    } catch (error) {
        console.error('Error loading data from Supabase:', error);
    }
}

/**
 * Load users from public.users table
 */
async function loadUsers() {
    const { data, error } = await supabase.from('users').select('*');
    if (error) {
        console.error('Error loading users:', error);
        return;
    }
    mockUsers = data || [];
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
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching user by id:', error);
        return null;
    }

    return data || null;
}

/**
 * Load inventory items from public.inventory_items table
 */
async function loadInventoryItems() {
    const { data, error } = await supabase.from('inventory_items').select('*');
    if (error) {
        console.error('Error loading inventory items:', error);
        return;
    }
    inventoryItems = data || [];
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
    const { data, error } = await supabase.from('projects').select('*');
    if (error) {
        console.error('Error loading projects:', error);
        return;
    }
    projects = data.map(proj => ({
        ...proj,
        collaborators: [],
        itemsOut: [],
        ownerId: proj.owner_id,
        description: proj.description || '',
        name: proj.name || ''
    })) || [];
    console.log(`Loaded ${projects.length} projects`);
}

/**
 * Load categories from public.categories table
 */
async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('name');
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
    const { data, error } = await supabase.from('visibility_tags').select('name');
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
    const { data, error } = await supabase.from('activity_logs').select('*').order('timestamp', { ascending: false });
    if (error) {
        console.error('Error loading activity logs:', error);
        return;
    }
    activityLogs = data || [];
    console.log(`Loaded ${activityLogs.length} activity logs`);
}

/**
 * Load help requests from public.help_requests table
 */
async function loadHelpRequests() {
    const { data, error } = await supabase.from('help_requests').select('*').order('timestamp', { ascending: false });
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
    const { data, error } = await supabase.from('extension_requests').select('*').order('timestamp', { ascending: false });
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
        loadExtensionRequests()
    ]);
}

/**
 * Load project collaborators and attach to projects
 */
async function loadProjectCollaborators() {
    const { data, error } = await supabase.from('project_collaborators').select('project_id, user_id');
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
    const { data, error } = await supabase.from('project_items_out').select('*');
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
                assignedToUserId: null,
                signedOutByUserId: null
            });
        }
    });
}

/**
 * Load inventory item visibility tags
 */
async function loadInventoryItemVisibility() {
    const { data, error } = await supabase.from('inventory_item_visibility').select('item_id, tag_id');
    if (error) {
        console.error('Error loading item visibility tags:', error);
        return;
    }

    const { data: tagRows, error: tagError } = await supabase.from('visibility_tags').select('id, name');
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
    const [
        classesRes,
        studentsRes,
        visibleItemsRes,
        classTagsRes,
        duePolicyRes,
        duePeriodsRes,
        permissionsRes
    ] = await Promise.all([
        supabase.from('student_classes').select('id, name, teacher_id'),
        supabase.from('class_students').select('class_id, student_id'),
        supabase.from('class_visible_items').select('class_id, item_id'),
        supabase.from('class_visibility_tags').select('class_id, visibility_tags(name)'),
        supabase.from('class_due_policy').select('class_id, default_signout_minutes, class_period_minutes, timezone'),
        supabase.from('class_due_policy_periods').select('class_id, start_time, end_time, return_class_periods'),
        supabase.from('class_permissions').select('class_id, can_create_projects, can_join_projects, can_sign_out')
    ]);

    const errors = [
        classesRes.error,
        studentsRes.error,
        visibleItemsRes.error,
        classTagsRes.error,
        duePolicyRes.error,
        duePeriodsRes.error,
        permissionsRes.error
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
            classPeriodMinutes: row.class_period_minutes,
            timezone: row.timezone,
            periodRanges: []
        };
    });

    (duePeriodsRes.data || []).forEach(row => {
        if (!duePolicyByClass[row.class_id]) {
            duePolicyByClass[row.class_id] = {
                defaultSignoutMinutes: 80,
                classPeriodMinutes: 50,
                timezone: 'America/Edmonton',
                periodRanges: []
            };
        }

        duePolicyByClass[row.class_id].periodRanges.push({
            start: String(row.start_time).slice(0, 5),
            end: String(row.end_time).slice(0, 5),
            returnClassPeriods: row.return_class_periods
        });
    });

    Object.keys(duePolicyByClass).forEach(classId => {
        duePolicyByClass[classId].periodRanges.sort((a, b) => a.start.localeCompare(b.start));
    });

    const permissionsByClass = {};
    (permissionsRes.data || []).forEach(row => {
        permissionsByClass[row.class_id] = {
            canCreateProjects: row.can_create_projects,
            canJoinProjects: row.can_join_projects,
            canSignOut: row.can_sign_out
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
            classPeriodMinutes: 50,
            timezone: 'America/Edmonton',
            periodRanges: [{ start: '08:00', end: '08:55', returnClassPeriods: 2 }]
        },
        defaultPermissions: permissionsByClass[cls.id] || {
            canCreateProjects: false,
            canJoinProjects: true,
            canSignOut: true
        }
    }));

    console.log(`Loaded ${studentClasses.length} student classes`);
}

/**
 * Upsert a student class and all child relations
 */
async function saveStudentClassToSupabase(cls) {
    const duePolicy = cls.duePolicy || {
        defaultSignoutMinutes: 80,
        classPeriodMinutes: 50,
        timezone: 'America/Edmonton',
        periodRanges: [{ start: '08:00', end: '08:55', returnClassPeriods: 2 }]
    };

    const defaultPermissions = cls.defaultPermissions || {
        canCreateProjects: false,
        canJoinProjects: true,
        canSignOut: true
    };

    const { error: classError } = await supabase.from('student_classes').upsert([
        {
            id: cls.id,
            name: cls.name,
            teacher_id: cls.teacherId || null
        }
    ], { onConflict: 'id' });

    if (classError) {
        console.error('Error upserting student_classes:', classError);
        return false;
    }

    const { error: dueError } = await supabase.from('class_due_policy').upsert([
        {
            class_id: cls.id,
            default_signout_minutes: duePolicy.defaultSignoutMinutes,
            class_period_minutes: duePolicy.classPeriodMinutes,
            timezone: duePolicy.timezone || 'America/Edmonton'
        }
    ], { onConflict: 'class_id' });

    if (dueError) {
        console.error('Error upserting class_due_policy:', dueError);
        return false;
    }

    const { error: permissionsError } = await supabase.from('class_permissions').upsert([
        {
            class_id: cls.id,
            can_create_projects: !!defaultPermissions.canCreateProjects,
            can_join_projects: !!defaultPermissions.canJoinProjects,
            can_sign_out: !!defaultPermissions.canSignOut
        }
    ], { onConflict: 'class_id' });

    if (permissionsError) {
        console.error('Error upserting class_permissions:', permissionsError);
        return false;
    }

    const { error: clearStudentsError } = await supabase.from('class_students').delete().eq('class_id', cls.id);
    if (clearStudentsError) {
        console.error('Error clearing class_students:', clearStudentsError);
        return false;
    }
    if ((cls.students || []).length > 0) {
        const { error: insertStudentsError } = await supabase.from('class_students').insert(
            cls.students.map(studentId => ({ class_id: cls.id, student_id: studentId }))
        );
        if (insertStudentsError) {
            console.error('Error inserting class_students:', insertStudentsError);
            return false;
        }
    }

    const { error: clearItemsError } = await supabase.from('class_visible_items').delete().eq('class_id', cls.id);
    if (clearItemsError) {
        console.error('Error clearing class_visible_items:', clearItemsError);
        return false;
    }
    if ((cls.visibleItemIds || []).length > 0) {
        const { error: insertItemsError } = await supabase.from('class_visible_items').insert(
            cls.visibleItemIds.map(itemId => ({ class_id: cls.id, item_id: itemId }))
        );
        if (insertItemsError) {
            console.error('Error inserting class_visible_items:', insertItemsError);
            return false;
        }
    }

    const { error: clearTagsError } = await supabase.from('class_visibility_tags').delete().eq('class_id', cls.id);
    if (clearTagsError) {
        console.error('Error clearing class_visibility_tags:', clearTagsError);
        return false;
    }
    if ((cls.allowedVisibilityTags || []).length > 0) {
        const { data: tagRows, error: tagsLookupError } = await supabase
            .from('visibility_tags')
            .select('id, name')
            .in('name', cls.allowedVisibilityTags);
        if (tagsLookupError) {
            console.error('Error looking up visibility_tags:', tagsLookupError);
            return false;
        }

        if ((tagRows || []).length > 0) {
            const { error: insertTagsError } = await supabase.from('class_visibility_tags').insert(
                tagRows.map(tag => ({ class_id: cls.id, tag_id: tag.id }))
            );
            if (insertTagsError) {
                console.error('Error inserting class_visibility_tags:', insertTagsError);
                return false;
            }
        }
    }

    const { error: clearPeriodsError } = await supabase.from('class_due_policy_periods').delete().eq('class_id', cls.id);
    if (clearPeriodsError) {
        console.error('Error clearing class_due_policy_periods:', clearPeriodsError);
        return false;
    }
    if ((duePolicy.periodRanges || []).length > 0) {
        const { error: insertPeriodsError } = await supabase.from('class_due_policy_periods').insert(
            duePolicy.periodRanges.map(period => ({
                class_id: cls.id,
                start_time: period.start,
                end_time: period.end,
                return_class_periods: period.returnClassPeriods
            }))
        );
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
    const { error } = await supabase.from('student_classes').delete().eq('id', classId);
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
    const { data, error } = await supabase.from('users').insert([{
        id: user.id,
        name: user.name,
        role: user.role,
        status: user.status || 'Active'
    }]);
    
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
    const { data, error } = await supabase.from('users')
        .update(updates)
        .eq('id', userId);
    
    if (error) {
        console.error('Error updating user:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Delete user from users table
 */
async function deleteUserFromSupabase(userId) {
    const { error } = await supabase.from('users')
        .delete()
        .eq('id', userId);

    if (error) {
        console.error('Error deleting user:', error);
        return false;
    }
    return true;
}

/**
 * Add inventory item to inventory_items table
 */
async function addItemToSupabase(item) {
    const { data, error } = await supabase.from('inventory_items').insert([{
        id: item.id,
        name: item.name,
        category: item.category,
        sku: item.sku,
        stock: item.stock || 0,
        threshold: item.threshold || 5,
        status: item.status || 'Active'
    }]);
    
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
    const { data, error } = await supabase.from('inventory_items')
        .update(updates)
        .eq('id', itemId);
    
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
    const { data, error } = await supabase.from('projects').insert([{
        id: project.id,
        name: project.name,
        owner_id: project.ownerId,
        description: project.description || '',
        status: project.status || 'Active'
    }]);
    
    if (error) {
        console.error('Error adding project:', error);
        return null;
    }
    return data?.[0] || project;
}

/**
 * Update project in projects table
 */
async function updateProjectInSupabase(projectId, updates) {
    const { data, error } = await supabase.from('projects')
        .update(updates)
        .eq('id', projectId);
    
    if (error) {
        console.error('Error updating project:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Add project item out to project_items_out table
 */
async function addProjectItemOutToSupabase(itemOut) {
    const { data, error } = await supabase.from('project_items_out').insert([{
        project_id: itemOut.projectId,
        item_id: itemOut.itemId,
        quantity: itemOut.quantity,
        signout_date: itemOut.signoutDate,
        due_date: itemOut.dueDate
    }]);
    
    if (error) {
        console.error('Error adding project item out:', error);
        return null;
    }
    return data?.[0];
}

/**
 * Return item (delete from project_items_out)
 */
async function returnItemToSupabase(projectItemOutId) {
    const { error } = await supabase.from('project_items_out')
        .delete()
        .eq('id', projectItemOutId);
    
    if (error) {
        console.error('Error returning item:', error);
        return false;
    }
    return true;
}

/**
 * Update due date for an existing project item out row
 */
async function updateProjectItemOutDueDateInSupabase(projectItemOutId, dueDate) {
    const { data, error } = await supabase
        .from('project_items_out')
        .update({ due_date: dueDate })
        .eq('id', projectItemOutId);

    if (error) {
        console.error('Error updating project item due date:', error);
        return null;
    }
    return data?.[0] || null;
}

/**
 * Add activity log to activity_logs table
 */
async function addActivityLogToSupabase(log) {
    const { data, error } = await supabase.from('activity_logs').insert([{
        id: log.id,
        timestamp: log.timestamp,
        user_id: log.userId,
        action: log.action,
        details: log.details
    }]);
    
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
    const { data, error } = await supabase.from('help_requests').insert([{
        id: request.id,
        name: request.name,
        email: request.email,
        description: request.description,
        status: request.status || 'Pending',
        timestamp: request.timestamp
    }]);
    
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
    const { data, error } = await supabase.from('help_requests')
        .update({ status })
        .eq('id', requestId);
    
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
    const { data, error } = await supabase.from('extension_requests').insert([{
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
    }]);
    
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
    const { data, error } = await supabase.from('extension_requests')
        .update({ status })
        .eq('id', requestId);

    if (error) {
        console.error('Error updating extension request:', error);
        return null;
    }
    return data?.[0] || null;
}

/**
 * Add category to categories table
 */
async function addCategoryToSupabase(name) {
    const { data, error } = await supabase.from('categories').insert([{ name }]);
    
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
    const { error } = await supabase.from('categories')
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
    const { data: existing, error: existingErr } = await supabase
        .from('categories')
        .select('name')
        .eq('name', newName)
        .maybeSingle();

    if (existingErr) {
        console.error('Error checking existing category:', existingErr);
        return false;
    }

    if (!existing) {
        const { error: addErr } = await supabase.from('categories').insert([{ name: newName }]);
        if (addErr) {
            console.error('Error creating new category name:', addErr);
            return false;
        }
    }

    const { error: updateItemsErr } = await supabase
        .from('inventory_items')
        .update({ category: newName })
        .eq('category', oldName);

    if (updateItemsErr) {
        console.error('Error reassigning inventory item categories:', updateItemsErr);
        return false;
    }

    const { error: deleteOldErr } = await supabase
        .from('categories')
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
    const { data, error } = await supabase.from('visibility_tags').insert([{ name }]);
    
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
    const { data, error } = await supabase
        .from('visibility_tags')
        .update({ name: newName })
        .eq('name', oldName);

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
    const { error } = await supabase
        .from('visibility_tags')
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
    const { data, error } = await supabase.from('inventory_item_visibility').insert([{
        item_id: itemId,
        tag_id: tagId
    }]);
    
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
    const { error: clearError } = await supabase
        .from('inventory_item_visibility')
        .delete()
        .eq('item_id', itemId);

    if (clearError) {
        console.error('Error clearing item visibility tags:', clearError);
        return false;
    }

    if (!Array.isArray(tagNames) || tagNames.length === 0) {
        return true;
    }

    const { data: tagRows, error: tagsError } = await supabase
        .from('visibility_tags')
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
    const { error: insertError } = await supabase
        .from('inventory_item_visibility')
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
    const { data, error } = await supabase.from('project_collaborators').insert([{
        project_id: projectId,
        user_id: userId
    }]);
    
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
    const { error } = await supabase.from('project_collaborators')
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
