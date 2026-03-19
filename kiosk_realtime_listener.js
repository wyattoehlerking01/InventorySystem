#!/usr/bin/env node

const path = require('path');
const { spawn, exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const KIOSK_ID = process.env.KIOSK_ID || 'KIOSK-001';

const LOCK_OVERLAY_COMMAND = process.env.LOCK_OVERLAY_COMMAND || '';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const UNLOCK_SCRIPT_PATH = process.env.UNLOCK_SCRIPT_PATH || path.resolve(__dirname, 'unlock_door.py');

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[kiosk-listener] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

let channel = null;
let pulseInFlight = false;
let previousLockState = null;

function runShellCommand(command) {
    return new Promise((resolve) => {
        if (!command || !command.trim()) {
            console.warn('[kiosk-listener] LOCK_OVERLAY_COMMAND is not set; skipping overlay command.');
            resolve(false);
            return;
        }

        exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[kiosk-listener] Lock overlay command failed:', error.message);
                if (stderr) console.error(stderr.trim());
                resolve(false);
                return;
            }

            if (stdout && stdout.trim()) console.log(stdout.trim());
            resolve(true);
        });
    });
}

function runUnlockScript() {
    return new Promise((resolve) => {
        const child = spawn(PYTHON_BIN, [UNLOCK_SCRIPT_PATH], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        let stdout = '';

        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });

        child.stderr.on('data', (chunk) => {
            stderr += String(chunk);
        });

        child.on('error', (error) => {
            console.error('[kiosk-listener] Failed to launch unlock script:', error.message);
            resolve(false);
        });

        child.on('close', (code) => {
            if (stdout.trim()) console.log(`[kiosk-listener] unlock stdout: ${stdout.trim()}`);
            if (stderr.trim()) console.error(`[kiosk-listener] unlock stderr: ${stderr.trim()}`);

            if (code === 0) {
                console.log('[kiosk-listener] Door unlock pulse executed successfully.');
                resolve(true);
            } else {
                console.error(`[kiosk-listener] unlock_door.py exited with code ${code}`);
                resolve(false);
            }
        });
    });
}

async function clearUnlockPulseFlag() {
    const { error } = await supabase
        .from('kiosk_settings')
        .update({ trigger_unlock_pulse: false })
        .eq('kiosk_id', KIOSK_ID);

    if (error) {
        console.error('[kiosk-listener] Failed to reset trigger_unlock_pulse:', error.message);
        return false;
    }

    return true;
}

async function processKioskSettingsRow(row, source = 'event') {
    if (!row) return;

    if (row.kiosk_id && row.kiosk_id !== KIOSK_ID) return;

    const isLocked = row.is_locked === true;

    if (isLocked && previousLockState !== true) {
        console.log(`[kiosk-listener] (${source}) kiosk is_locked=true, running overlay command.`);
        await runShellCommand(LOCK_OVERLAY_COMMAND);
    }

    previousLockState = isLocked;

    const shouldPulseUnlock = row.trigger_unlock_pulse === true && row.door_unlock_enabled === true;
    if (!shouldPulseUnlock || pulseInFlight) return;

    pulseInFlight = true;
    try {
        console.log(`[kiosk-listener] (${source}) unlock pulse requested for kiosk ${KIOSK_ID}.`);
        await runUnlockScript();
    } finally {
        await clearUnlockPulseFlag();
        pulseInFlight = false;
    }
}

async function fetchInitialSettings() {
    const { data, error } = await supabase
        .from('kiosk_settings')
        .select('kiosk_id, is_locked, trigger_unlock_pulse, door_unlock_enabled')
        .eq('kiosk_id', KIOSK_ID)
        .maybeSingle();

    if (error) {
        console.error('[kiosk-listener] Failed to load initial kiosk_settings row:', error.message);
        return null;
    }

    return data || null;
}

async function start() {
    console.log(`[kiosk-listener] Starting listener for kiosk_id=${KIOSK_ID}`);

    const initialRow = await fetchInitialSettings();
    if (initialRow) {
        await processKioskSettingsRow(initialRow, 'startup');
    } else {
        console.warn('[kiosk-listener] No kiosk_settings row found at startup; waiting for realtime changes.');
    }

    channel = supabase
        .channel(`kiosk-settings-${KIOSK_ID}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'kiosk_settings',
            filter: `kiosk_id=eq.${KIOSK_ID}`
        }, async (payload) => {
            const row = payload.new || payload.old;
            await processKioskSettingsRow(row, payload.eventType || 'realtime');
        })
        .subscribe((status) => {
            console.log(`[kiosk-listener] Realtime status: ${status}`);
        });
}

async function shutdown() {
    console.log('\n[kiosk-listener] Shutting down...');
    if (channel) {
        await supabase.removeChannel(channel);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
    console.error('[kiosk-listener] Fatal startup error:', error);
    process.exit(1);
});
