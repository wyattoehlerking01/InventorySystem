#!/usr/bin/env python3
"""Door controller server for Raspberry Pi.

Handles door hold-open state changes via Flask.
Integrates with Supabase for unlock job tracking.
"""

import json
import os
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
        user_id = request.args.get('userId', 'SYSTEM')
        unlock_job_id = request.args.get('unlockJobId')
        
        logger.info(f"Trigger: userId={user_id}, jobId={unlock_job_id}")
        
        # Pulse the door
        door_lock.on()
        logger.info("Door activated (pulse)")
        
        import time
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
