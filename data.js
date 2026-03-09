// Mock Data for Nexus Inventory System

const mockUsers = [
    { id: 'STU-123', name: 'Alex Freeman', role: 'student', status: 'Active' },
    { id: 'STU-999', name: 'James Suspended', role: 'student', status: 'Suspended' },
    { id: 'TCH-456', name: 'Dr. Sarah Chen', role: 'teacher', status: 'Active' },
    { id: 'DEV-789', name: 'Marcus Tech', role: 'developer', status: 'Active' },
    { id: 'STU-555', name: 'Lisa Suspended', role: 'student', status: 'Suspended' }
];

let helpRequests = [
    { id: 'REQ-001', name: 'Emma Wilson', email: 'emma.w@school.edu', description: 'I lost my barcode, can I get a new one?', status: 'Pending', timestamp: new Date(Date.now() - 86400000).toISOString() }
];

let extensionRequests = [];

let categories = ['Electronics', 'Hardware', 'Consumables'];

let inventoryItems = [
    { id: 'ITM-001', name: 'Arduino Uno R3', category: 'Electronics', sku: 'ARD-001', stock: 45, threshold: 10, status: 'In Stock' },
    { id: 'ITM-002', name: 'Raspberry Pi 4 8GB', category: 'Electronics', sku: 'RPI-004', stock: 12, threshold: 15, status: 'Low Stock' },
    { id: 'ITM-003', name: 'Soldering Iron Station', category: 'Hardware', sku: 'SLD-001', stock: 5, threshold: 5, status: 'Low Stock' },
    { id: 'ITM-004', name: 'Resistor Kit (10k Ohm)', category: 'Consumables', sku: 'RES-10K', stock: 200, threshold: 50, status: 'In Stock' },
    { id: 'ITM-005', name: '3D Printer Filament (PLA)', category: 'Consumables', sku: 'PLA-BLK', stock: 2, threshold: 5, status: 'Critical' },
    { id: 'ITM-006', name: 'Digital Multimeter', category: 'Hardware', sku: 'DMM-001', stock: 15, threshold: 5, status: 'In Stock' },
];

let projects = [
    {
        id: 'PRJ-101',
        name: 'Autonomous Rover',
        ownerId: 'STU-123',
        description: 'Building a line-following rover with obstacle avoidance.',
        collaborators: ['TCH-456'],
        status: 'Active',
        itemsOut: [
            { itemId: 'ITM-001', quantity: 1, signoutDate: '2026-03-01T10:00:00Z', dueDate: new Date(Date.now() + 86400000 * 3).toISOString() },
            { itemId: 'ITM-006', quantity: 1, signoutDate: '2026-03-01T10:05:00Z', dueDate: new Date(Date.now() + 86400000 * 2).toISOString() }
        ]
    },
    {
        id: 'PRJ-102',
        name: 'Weather Station',
        ownerId: 'TCH-456',
        description: 'IoT weather station for the science department.',
        collaborators: ['STU-123', 'DEV-789'],
        status: 'Active',
        itemsOut: [
            { itemId: 'ITM-002', quantity: 2, signoutDate: '2026-03-05T14:30:00Z', dueDate: new Date(Date.now() - 86400000).toISOString() }
        ]
    }
];

let activityLogs = [
    { id: 'LOG-001', timestamp: '2026-03-01T10:00:00Z', userId: 'STU-123', action: 'Sign Out', details: 'Signed out 1x Arduino Uno R3 for Project Autonomous Rover' },
    { id: 'LOG-002', timestamp: '2026-03-01T10:05:00Z', userId: 'STU-123', action: 'Sign Out', details: 'Signed out 1x Digital Multimeter for Project Autonomous Rover' },
    { id: 'LOG-003', timestamp: '2026-03-05T14:30:00Z', userId: 'TCH-456', action: 'Sign Out', details: 'Signed out 2x Raspberry Pi 4 8GB for Project Weather Station' },
    { id: 'LOG-004', timestamp: '2026-03-08T09:15:00Z', userId: 'DEV-789', action: 'Add Item', details: 'Added new inventory item: Resistor Kit (10k Ohm)' },
];

function generateId(prefix) {
    return prefix + '-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

// Utility to write a log
function addLog(userId, action, details) {
    activityLogs.unshift({
        id: generateId('LOG'),
        timestamp: new Date().toISOString(),
        userId: userId,
        action: action,
        details: details
    });
}
