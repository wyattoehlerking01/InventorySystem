#!/usr/bin/env python3
"""Door controller server for Raspberry Pi.

Handles door hold-open state changes via Flask.
Integrates with Supabase for unlock job tracking.
"""

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from flask import Flask, request, jsonify
import gpiozero
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration
PORT = int(os.getenv("DOOR_CONTROLLER_PORT", "8090"))
DOOR_PIN = int(os.getenv("DOOR_PIN", "17"))
DOOR_PULSE_SECONDS = float(os.getenv("DOOR_PULSE_SECONDS", "3"))


def _write_unlock_context(user_id, unlock_job_id=None):
    try:
        path = os.getenv("DOOR_UNLOCK_CONTEXT_FILE", "/var/lib/inventory-door/unlock-context.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        payload = {
            "user_id": user_id,
            "unlock_job_id": unlock_job_id,
            "recorded_at": time.time()
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except Exception as e:
        logger.warning(f"Could not write unlock context: {e}")


def _log_activity_event(user_id, action="Door Unlock", details=None):
    supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    supabase_key = (
        os.getenv("SUPABASE_PI_RPC_KEY")
        or os.getenv("SUPABASE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_ANON_KEY")
        or ""
    ).strip()
    if not supabase_url or not supabase_key:
        return
    try:
        url = f"{supabase_url}/rest/v1/activity_logs"
        log_payload = {
            "id": f"LOG-PI-{int(time.time() * 1000)}-{os.urandom(4).hex()}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user_id": user_id,
            "action": action,
            "details": details or f"Door triggered for user {user_id}"
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(log_payload).encode("utf-8"),
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5):
            pass
        logger.info(f"Logged activity event to Supabase for user {user_id}")
    except Exception as e:
        logger.warning(f"Failed to send activity log to Supabase: {e}")


# GPIO setup
try:
    door_lock = gpiozero.DigitalOutputDevice(DOOR_PIN, active_high=True, initial_value=False)
    logger.info(f"GPIO initialized on pin {DOOR_PIN}")
except Exception as e:
    logger.error(f"Failed to initialize GPIO: {e}")
    door_lock = None

door_held_open = False


@app.route('/trigger', methods=['GET'])
def trigger():
    """Momentary door unlock pulse (3 seconds default)."""
    if door_lock is None:
        return jsonify({"status": "error", "message": "GPIO not initialized"}), 500
    
    try:
        user_id = (
            request.args.get('userid')
            or request.args.get('userId')
            or request.args.get('actorUserId')
            or 'SYSTEM'
        )
        unlock_job_id = request.args.get('unlockJobId')
        
        logger.info(f"Trigger: userId={user_id}, jobId={unlock_job_id}")
        
        _write_unlock_context(user_id, unlock_job_id)
        _log_activity_event(user_id, action="Door Unlock", details=f"Door triggered pulse for user {user_id}")

        # Pulse the door
        door_lock.on()
        logger.info("Door activated (pulse)")
        
        time.sleep(DOOR_PULSE_SECONDS)
        
        door_lock.off()
        logger.info("Door deactivated (pulse complete)")
        
        return jsonify({
            "status": "success",
            "message": f"Door triggered for {DOOR_PULSE_SECONDS}s",
            "door_held": False
        }), 200
    except Exception as e:
        logger.error(f"Trigger error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/holdopen', methods=['POST'])
def holdopen():
    """Hold the door open or return it to normal operation."""
    if door_lock is None:
        return jsonify({"status": "error", "message": "GPIO not initialized"}), 500
    
    try:
        data = request.get_json() or {}
        actor = data.get('actor', 'SYSTEM')
        reason = data.get('reason', 'api-holdopen')
        action = str(data.get('action', 'hold-open')).strip().lower()
        unlock_job_id = data.get('unlockJobId')
        
        logger.info(f"Hold-open: actor={actor}, reason={reason}, action={action}, jobId={unlock_job_id}")
        
        global door_held_open
        if action in ("hold-open", "holdopen", "hold"):
            door_held_open = True
            door_lock.on()
            logger.info("Door held open")

            return jsonify({
                "status": "success",
                "message": f"Door held open (reason: {reason})",
                "door_held": True
            }), 200

        door_held_open = False
        door_lock.off()
        logger.info("Door returned to normal operation")

        return jsonify({
            "status": "success",
            "message": "Door returned to normal operation",
            "door_held": False
        }), 200
    except Exception as e:
        logger.error(f"Hold-open error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/status', methods=['GET'])
def status():
    """Get door controller status."""
    return jsonify({
        "status": "success",
        "port": PORT,
        "door_pin": DOOR_PIN,
        "door_held": door_held_open,
        "gpio_available": door_lock is not None
    }), 200


@app.errorhandler(404)
def not_found(e):
    return jsonify({"status": "error", "message": "Endpoint not found"}), 404


if __name__ == '__main__':
    logger.info(f"Starting door controller on port {PORT}")
    logger.info(f"Door PIN: {DOOR_PIN}, Pulse duration: {DOOR_PULSE_SECONDS}s")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
