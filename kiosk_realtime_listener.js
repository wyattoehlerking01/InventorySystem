#!/usr/bin/env node

const { spawn } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const KIOSK_ID = process.env.KIOSK_ID || 'KIOSK-001';

const LOCK_OVERLAY_COMMAND_BIN = String(process.env.LOCK_OVERLAY_COMMAND_BIN || '').trim();
const LOCK_OVERLAY_COMMAND_ARGS = parseCommandArgs(process.env.LOCK_OVERLAY_COMMAND_ARGS || '');
const LEGACY_LOCK_OVERLAY_COMMAND = String(process.env.LOCK_OVERLAY_COMMAND || '').trim();
const LED_TRIGGER_URL = resolveLedTriggerUrl();

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[kiosk-listener] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

let channel = null;
let doorJobsChannel = null;
let doorJobsSweepInterval = null;
let pulseInFlight = false;
let previousLockState = null;
let doorJobInFlight = false;

function parseCommandArgs(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('LOCK_OVERLAY_COMMAND_ARGS must be a JSON array');
        return parsed.map((part) => String(part));
    } catch (error) {
        console.error('[kiosk-listener] Invalid LOCK_OVERLAY_COMMAND_ARGS. Expected JSON array of strings.');
        console.error('[kiosk-listener] Parse error:', error.message);
        return [];
    }
}

function resolveLedTriggerUrl() {
    const explicitUrl = String(process.env.LED_TRIGGER_URL || '').trim();
    if (explicitUrl) return explicitUrl;

    const gpioUrl = String(process.env.GPIO_SERVER_URL || '').trim();
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

function runOverlayCommand() {
    return new Promise((resolve) => {
        if (!LOCK_OVERLAY_COMMAND_BIN) {
            if (LEGACY_LOCK_OVERLAY_COMMAND) {
                console.error('[kiosk-listener] LOCK_OVERLAY_COMMAND is deprecated for security.');
                console.error('[kiosk-listener] Use LOCK_OVERLAY_COMMAND_BIN and optional LOCK_OVERLAY_COMMAND_ARGS (JSON array).');
            } else {
                console.warn('[kiosk-listener] LOCK_OVERLAY_COMMAND_BIN is not set; skipping overlay command.');
            }
            resolve(false);
            return;
        }

        const child = spawn(LOCK_OVERLAY_COMMAND_BIN, LOCK_OVERLAY_COMMAND_ARGS, {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: false,
            timeout: 15000
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
            console.error('[kiosk-listener] Lock overlay command failed to start:', error.message);
            resolve(false);
        });

        child.on('close', (code, signal) => {
            if (stdout.trim()) console.log(`[kiosk-listener] overlay stdout: ${stdout.trim()}`);
            if (stderr.trim()) console.error(`[kiosk-listener] overlay stderr: ${stderr.trim()}`);

            if (code === 0) {
                resolve(true);
                return;
            }

            if (signal) {
                console.error(`[kiosk-listener] overlay command terminated by signal ${signal}`);
            } else {
                console.error(`[kiosk-listener] overlay command exited with code ${code}`);
            }
            resolve(false);
        });
    });
}

function triggerDoorAttentionLed() {
    return new Promise((resolve) => {
        if (!LED_TRIGGER_URL) {
            console.warn('[kiosk-listener] LED_TRIGGER_URL/GPIO_SERVER_URL not configured; attention LED skipped.');
            resolve(false);
            return;
        }

        let url;
        try {
            url = new URL(LED_TRIGGER_URL);
        } catch {
            console.error('[kiosk-listener] LED trigger URL is invalid:', LED_TRIGGER_URL);
            resolve(false);
            return;
        }

        const protocol = url.protocol === 'https:' ? require('https') : require('http');
        const req = protocol.request(url, {
            method: 'GET',
            timeout: 5000
        }, (res) => {
            res.resume();
            resolve(res.statusCode >= 200 && res.statusCode < 500);
        });

        req.on('error', (error) => {
            console.error('[kiosk-listener] Failed to trigger attention LED:', error.message);
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy(new Error('LED trigger request timed out'));
        });

        req.end();
    });
}

function announceDoorOpen() {
    return new Promise((resolve) => {
        const candidates = [
            ['spd-say', ['door open']],
            ['espeak', ['door open']],
            ['say', ['door open']]
        ];

        const tryNext = (index) => {
            if (index >= candidates.length) {
                console.log('door open');
                resolve(true);
                return;
            }

            const [bin, args] = candidates[index];
            const child = spawn(bin, args, {
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

            child.on('error', () => {
                tryNext(index + 1);
            });

            child.on('close', (code) => {
                if (code === 0) {
                    if (stdout.trim()) console.log(`[kiosk-listener] announce stdout: ${stdout.trim()}`);
                    if (stderr.trim()) console.error(`[kiosk-listener] announce stderr: ${stderr.trim()}`);
                    resolve(true);
                    return;
                }

                tryNext(index + 1);
            });
        };

        tryNext(0);
    });
}

async function handleDoorOpenRequest(contextLabel) {
    const announced = await announceDoorOpen();
    const ledTriggered = await triggerDoorAttentionLed();

    if (announced && ledTriggered) {
        console.log(`[kiosk-listener] ${contextLabel}: announced "door open" and triggered attention LED.`);
        return true;
    }

    if (!announced) {
        console.error(`[kiosk-listener] ${contextLabel}: failed to announce door open.`);
    }
    if (!ledTriggered) {
        console.error(`[kiosk-listener] ${contextLabel}: failed to trigger attention LED.`);
    }
    return announced && ledTriggered;
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
        await runOverlayCommand();
    }

    previousLockState = isLocked;

    const shouldPulseUnlock = row.trigger_unlock_pulse === true && row.door_unlock_enabled === true;
    if (!shouldPulseUnlock || pulseInFlight) return;

    pulseInFlight = true;
    try {
        console.log(`[kiosk-listener] (${source}) door open requested for kiosk ${KIOSK_ID}.`);
        await handleDoorOpenRequest(`kiosk_settings/${source}`);
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

async function claimDoorUnlockJob(jobId) {
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
        .from('door_unlock_jobs')
        .update({
            status: 'processing',
            started_at: startedAt,
            status_message: `Worker ${KIOSK_ID} started processing at ${startedAt}`
        })
        .eq('id', jobId)
        .eq('kiosk_id', KIOSK_ID)
        .eq('status', 'pending')
        .select('id, kiosk_id, action_type, item_id, quantity, project_name, request_payload, created_at')
        .maybeSingle();

    if (error) {
        console.error(`[kiosk-listener] Failed to claim door job ${jobId}:`, error.message);
        return null;
    }

    return data || null;
}

async function completeDoorUnlockJob(jobId, success, details = {}) {
    const now = new Date().toISOString();
    const status = success ? 'completed' : 'failed';

    const payload = {
        status,
        completed_at: now,
        status_message: details.statusMessage || (success
            ? `Worker ${KIOSK_ID} completed unlock.`
            : `Worker ${KIOSK_ID} failed unlock.`),
        result_payload: {
            worker_id: KIOSK_ID,
            success,
            processed_at: now,
            ...(details.resultPayload && typeof details.resultPayload === 'object' ? details.resultPayload : {})
        }
    };

    const { error } = await supabase
        .from('door_unlock_jobs')
        .update(payload)
        .eq('id', jobId)
        .eq('kiosk_id', KIOSK_ID);

    if (error) {
        console.error(`[kiosk-listener] Failed to finalize door job ${jobId}:`, error.message);
        return false;
    }

    return true;
}

async function processDoorUnlockJob(job) {
    if (!job || !job.id || doorJobInFlight) return;

    doorJobInFlight = true;
    try {
        const claimedJob = await claimDoorUnlockJob(job.id);
        if (!claimedJob) return;

        console.log(`[kiosk-listener] Processing door queue job ${claimedJob.id} for kiosk ${KIOSK_ID}.`);
        const success = await handleDoorOpenRequest(`door_unlock_job/${claimedJob.id}`);

        await completeDoorUnlockJob(claimedJob.id, success, {
            statusMessage: success
                ? `Unlock completed by worker ${KIOSK_ID}.`
                : `Unlock failed by worker ${KIOSK_ID}.`,
            resultPayload: {
                action_type: claimedJob.action_type,
                item_id: claimedJob.item_id,
                quantity: claimedJob.quantity,
                project_name: claimedJob.project_name
            }
        });
    } catch (error) {
        console.error('[kiosk-listener] Unexpected door job processing error:', error.message || error);
        if (job?.id) {
            await completeDoorUnlockJob(job.id, false, {
                statusMessage: `Unexpected worker error: ${String(error?.message || error)}`
            });
        }
    } finally {
        doorJobInFlight = false;
    }
}

async function processPendingDoorUnlockJobs() {
    if (doorJobInFlight) return;

    const { data, error } = await supabase
        .from('door_unlock_jobs')
        .select('id, kiosk_id, status')
        .eq('kiosk_id', KIOSK_ID)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(10);

    if (error) {
        console.error('[kiosk-listener] Failed to scan pending door jobs:', error.message);
        return;
    }

    for (const job of data || []) {
        await processDoorUnlockJob(job);
    }
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

    doorJobsChannel = supabase
        .channel(`door-jobs-${KIOSK_ID}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'door_unlock_jobs',
            filter: `kiosk_id=eq.${KIOSK_ID}`
        }, async (payload) => {
            const row = payload.new;
            if (!row || row.status !== 'pending') return;
            await processDoorUnlockJob(row);
        })
        .subscribe((status) => {
            console.log(`[kiosk-listener] Door queue realtime status: ${status}`);
        });

    doorJobsSweepInterval = setInterval(() => {
        void processPendingDoorUnlockJobs();
    }, 5000);

    void processPendingDoorUnlockJobs();
}

async function shutdown() {
    console.log('\n[kiosk-listener] Shutting down...');
    if (doorJobsSweepInterval) {
        clearInterval(doorJobsSweepInterval);
        doorJobsSweepInterval = null;
    }
    if (channel) {
        await supabase.removeChannel(channel);
    }
    if (doorJobsChannel) {
        await supabase.removeChannel(doorJobsChannel);
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
    console.error('[kiosk-listener] Fatal startup error:', error);
    process.exit(1);
});
