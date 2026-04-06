#!/usr/bin/env python3
import http.server
import socketserver
import json
import time
import os
import hmac

# Try importing RPi.GPIO to see if it's available.
# This prevents crashes if testing on a regular PC instead of a Pi.
try:
    import RPi.GPIO as GPIO
    GPIO_AVAILABLE = True
except ImportError:
    GPIO_AVAILABLE = False
    print("Warning: RPi.GPIO module not found. Running in simulation mode.")

# --- CONFIGURATION ---
PORT = 8080
DOOR_UNLOCK_PIN = int(os.getenv('DOOR_UNLOCK_PIN', '27'))  # BCM numbering; GPIO27 is physical pin 13
UNLOCK_DURATION = 3.0 # Seconds to keep the door unlocked
HOLD_OPEN_MAX_SECONDS = float(os.getenv('HOLD_OPEN_MAX_SECONDS', '0'))
DOOR_SENSOR_PIN = int(os.getenv('DOOR_SENSOR_PIN', '-1'))
DOOR_SENSOR_OPEN_STATE = str(os.getenv('DOOR_SENSOR_OPEN_STATE', 'HIGH')).strip().upper()
DOOR_SENSOR_PULL = str(os.getenv('DOOR_SENSOR_PULL', 'UP')).strip().upper()
DOOR_OPEN_ALERT_SECONDS = float(os.getenv('DOOR_OPEN_ALERT_SECONDS', '30'))
ASSIGN_ACTOR_WINDOW_SECONDS = float(os.getenv('ASSIGN_ACTOR_WINDOW_SECONDS', '30'))
DOOR_API_TOKEN = str(os.getenv('DOOR_API_TOKEN', '')).strip()
DOOR_ALLOWED_ORIGINS_RAW = str(os.getenv('DOOR_ALLOWED_ORIGINS', '')).strip()
# ---------------------

def _normalize_origin(origin):
    value = str(origin or '').strip().rstrip('/')
    return value.lower()

DOOR_ALLOWED_ORIGINS = {
    _normalize_origin(origin)
    for origin in DOOR_ALLOWED_ORIGINS_RAW.split(',')
    if origin.strip()
}

door_held_open = False
door_hold_started_at = None
door_position = 'unknown'
door_position_changed_at = None
door_open_started_at = None
door_last_closed_at = None
door_open_alerted = False
door_active_user_id = None
door_active_user_started_at = None
door_last_visit = None
door_last_actor_id = None
door_last_actor_recorded_at = None

if GPIO_AVAILABLE:
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(DOOR_UNLOCK_PIN, GPIO.OUT)
    GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)

    if DOOR_SENSOR_PIN >= 0:
        if DOOR_SENSOR_PULL == 'UP':
            GPIO.setup(DOOR_SENSOR_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        elif DOOR_SENSOR_PULL == 'DOWN':
            GPIO.setup(DOOR_SENSOR_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
        else:
            GPIO.setup(DOOR_SENSOR_PIN, GPIO.IN)

def _set_door_pin_high():
    if GPIO_AVAILABLE:
        GPIO.output(DOOR_UNLOCK_PIN, GPIO.HIGH)

def _set_door_pin_low():
    if GPIO_AVAILABLE:
        GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)

def _normalize_sensor_open_state(raw_state):
    normalized = str(raw_state or '').strip().lower()
    if normalized in ('1', 'true', 'high', 'open'):
        return GPIO.HIGH
    return GPIO.LOW

def _read_door_position():
    if not GPIO_AVAILABLE or DOOR_SENSOR_PIN < 0:
        return 'unknown'

    try:
        raw_state = GPIO.input(DOOR_SENSOR_PIN)
    except Exception as error:
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Failed to read door sensor pin {DOOR_SENSOR_PIN}: {error}")
        return 'unknown'

    sensor_open_state = _normalize_sensor_open_state(DOOR_SENSOR_OPEN_STATE)
    return 'open' if raw_state == sensor_open_state else 'closed'

def _record_last_actor(actor_id):
    global door_last_actor_id, door_last_actor_recorded_at

    normalized = str(actor_id or '').strip()
    if not normalized:
        return

    door_last_actor_id = normalized
    door_last_actor_recorded_at = time.time()

def _update_door_sensor_state():
    global door_position, door_position_changed_at, door_open_started_at
    global door_last_closed_at, door_open_alerted, door_active_user_id
    global door_active_user_started_at, door_last_visit

    current_position = _read_door_position()
    now = time.time()

    if current_position == 'unknown':
        return

    if door_position == current_position:
        if current_position == 'open' and DOOR_OPEN_ALERT_SECONDS > 0 and door_open_started_at:
            elapsed = max(0.0, now - door_open_started_at)
            if elapsed >= DOOR_OPEN_ALERT_SECONDS and not door_open_alerted:
                door_open_alerted = True
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Warning: door has remained open for {elapsed:.1f}s.")
        return

    previous_position = door_position
    door_position = current_position
    door_position_changed_at = now

    if current_position == 'open':
        door_open_started_at = now
        door_open_alerted = False

        actor_is_recent = (
            bool(door_last_actor_id)
            and bool(door_last_actor_recorded_at)
            and (now - door_last_actor_recorded_at) <= ASSIGN_ACTOR_WINDOW_SECONDS
        )
        door_active_user_id = door_last_actor_id if actor_is_recent else None
        door_active_user_started_at = now if door_active_user_id else None
        who = f" by {door_active_user_id}" if door_active_user_id else ''
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Door sensor indicates OPEN{who}.")

    elif current_position == 'closed':
        if previous_position == 'open' and door_open_started_at:
            elapsed = max(0.0, now - door_open_started_at)
            door_last_visit = {
                'user_id': door_active_user_id,
                'duration_seconds': round(elapsed, 3),
                'closed_at': now
            }
            who = f" by {door_active_user_id}" if door_active_user_id else ''
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Door sensor indicates CLOSED after {elapsed:.1f}s open{who}.")

        door_open_started_at = None
        door_open_alerted = False
        door_last_closed_at = now
        door_active_user_id = None
        door_active_user_started_at = None

def _json_response(handler, status_code, payload):
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    _add_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(payload).encode('utf-8'))

def _is_allowed_origin(origin):
    if not origin:
        return True
    if not DOOR_ALLOWED_ORIGINS:
        return True

    normalized = _normalize_origin(origin)
    if '*' in DOOR_ALLOWED_ORIGINS:
        return True
    return normalized in DOOR_ALLOWED_ORIGINS

def _add_cors_headers(handler):
    origin = str(handler.headers.get('Origin', '')).strip()
    if origin and _is_allowed_origin(origin):
        handler.send_header('Access-Control-Allow-Origin', origin)
        handler.send_header('Vary', 'Origin')
        handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        handler.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, X-Door-Token')

def _request_has_valid_token(handler):
    if not DOOR_API_TOKEN:
        return True
    provided = str(handler.headers.get('X-Door-Token', '')).strip()
    return hmac.compare_digest(provided, DOOR_API_TOKEN)

def _get_hold_elapsed_seconds():
    if not door_hold_started_at:
        return 0.0
    return max(0.0, time.time() - door_hold_started_at)

def _enforce_hold_safety_timeout():
    global door_held_open, door_hold_started_at

    if not door_held_open:
        return False
    if HOLD_OPEN_MAX_SECONDS <= 0:
        return False

    elapsed = _get_hold_elapsed_seconds()
    if elapsed < HOLD_OPEN_MAX_SECONDS:
        return False

    _set_door_pin_low()
    door_held_open = False
    door_hold_started_at = None
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Hold-open safety timeout reached. Door released.")
    return True

def _read_json_body(handler):
    raw_len = handler.headers.get('Content-Length', '0')
    try:
        content_length = int(raw_len)
    except (TypeError, ValueError):
        content_length = 0

    post_data = handler.rfile.read(content_length) if content_length > 0 else b'{}'
    if not post_data:
        return {}
    return json.loads(post_data.decode('utf-8'))

class UnlockRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        origin = str(self.headers.get('Origin', '')).strip()
        if origin and not _is_allowed_origin(origin):
            self.send_response(403)
            self.end_headers()
            return

        self.send_response(200, "ok")
        _add_cors_headers(self)
        self.end_headers()

    def do_GET(self):
        """Handle door status checks."""
        _enforce_hold_safety_timeout()
        _update_door_sensor_state()

        if self.path != '/status':
            self.send_response(404)
            self.end_headers()
            return

        door_open_seconds = 0.0
        active_user_seconds = 0.0
        left_open_too_long = False
        if door_position == 'open' and door_open_started_at:
            door_open_seconds = max(0.0, time.time() - door_open_started_at)
            left_open_too_long = DOOR_OPEN_ALERT_SECONDS > 0 and door_open_seconds >= DOOR_OPEN_ALERT_SECONDS

        if door_position == 'open' and door_active_user_id and door_active_user_started_at:
            active_user_seconds = max(0.0, time.time() - door_active_user_started_at)

        payload = {
            'status': 'success',
            'held_open': door_held_open,
            'held_open_seconds': round(_get_hold_elapsed_seconds(), 3),
            'gpio_available': GPIO_AVAILABLE,
            'unlock_duration_seconds': UNLOCK_DURATION,
            'hold_open_max_seconds': HOLD_OPEN_MAX_SECONDS,
            'door_sensor_enabled': GPIO_AVAILABLE and DOOR_SENSOR_PIN >= 0,
            'door_sensor_pin': DOOR_SENSOR_PIN,
            'door_sensor_open_state': DOOR_SENSOR_OPEN_STATE,
            'door_position': door_position,
            'door_position_changed_at': door_position_changed_at,
            'door_open_seconds': round(door_open_seconds, 3),
            'door_open_alert_seconds': DOOR_OPEN_ALERT_SECONDS,
            'left_open_too_long': left_open_too_long,
            'active_user_id': door_active_user_id,
            'active_user_seconds': round(active_user_seconds, 3),
            'last_visit_user_id': (door_last_visit or {}).get('user_id'),
            'last_visit_duration_seconds': (door_last_visit or {}).get('duration_seconds', 0.0),
            'last_visit_closed_at': (door_last_visit or {}).get('closed_at')
        }
        _json_response(self, 200, payload)

    def do_POST(self):
        """Handle the unlock request from the frontend app."""
        global door_held_open, door_hold_started_at

        _enforce_hold_safety_timeout()
        _update_door_sensor_state()

        if self.path in ['/unlock', '/hold-open', '/release']:
            if not _request_has_valid_token(self):
                _json_response(self, 401, {'status': 'error', 'message': 'Unauthorized'})
                return

            try:
                data = _read_json_body(self)
                item_id = data.get('itemId', 'Unknown')
                item_name = data.get('itemName', 'Unknown')
                category = data.get('category', 'Unknown')
                reason = data.get('reason', 'No reason provided')
                actor_id = data.get('userId')

                _record_last_actor(actor_id)
                
                if self.path == '/unlock':
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Unlock request received!")
                    print(f"Item: {item_name} ({item_id}) - Category: {category}")

                    if door_held_open:
                        response = {
                            'status': 'success',
                            'message': 'Door already held open',
                            'held_open': True,
                            'held_open_seconds': round(_get_hold_elapsed_seconds(), 3)
                        }
                        _json_response(self, 200, response)
                        return

                    if GPIO_AVAILABLE:
                        print(f"Unlocking door (Pin {DOOR_UNLOCK_PIN}) goes HIGH...")
                        _set_door_pin_high()
                        time.sleep(UNLOCK_DURATION)
                        print(f"Locking door (Pin {DOOR_UNLOCK_PIN}) goes LOW...")
                        _set_door_pin_low()
                    else:
                        print(f"SIMULATION: Door unlocked for {UNLOCK_DURATION} seconds. (GPIO not available)")
                        time.sleep(UNLOCK_DURATION)
                        print("SIMULATION: Door re-locked.")

                    response = {
                        'status': 'success',
                        'message': f'Door unlocked for {UNLOCK_DURATION}s',
                        'held_open': False,
                        'held_open_seconds': 0.0
                    }
                    _update_door_sensor_state()
                    _json_response(self, 200, response)
                    return

                if self.path == '/hold-open':
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Hold-open request received. Reason: {reason}")
                    if GPIO_AVAILABLE:
                        _set_door_pin_high()
                    else:
                        print('SIMULATION: Door hold-open enabled.')

                    door_held_open = True
                    door_hold_started_at = time.time()
                    response = {
                        'status': 'success',
                        'message': 'Door hold-open enabled',
                        'held_open': True,
                        'held_open_seconds': 0.0,
                        'hold_open_max_seconds': HOLD_OPEN_MAX_SECONDS
                    }
                    _update_door_sensor_state()
                    _json_response(self, 200, response)
                    return

                if self.path == '/release':
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Release request received. Reason: {reason}")
                    elapsed = _get_hold_elapsed_seconds()
                    if GPIO_AVAILABLE:
                        _set_door_pin_low()
                    else:
                        print('SIMULATION: Door release triggered.')

                    door_held_open = False
                    door_hold_started_at = None
                    response = {
                        'status': 'success',
                        'message': 'Door released',
                        'held_open': False,
                        'held_open_seconds': round(elapsed, 3)
                    }
                    _update_door_sensor_state()
                    _json_response(self, 200, response)
                    return
                
            except json.JSONDecodeError:
                response = {'status': 'error', 'message': 'Invalid JSON format'}
                _json_response(self, 400, response)
            except Exception as e:
                print(f"Error handling request: {e}")
                response = {'status': 'error', 'message': str(e)}
                _json_response(self, 500, response)
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    if not DOOR_API_TOKEN:
        print('Warning: DOOR_API_TOKEN is not set. Door endpoints are running without token authentication.')
    if not DOOR_ALLOWED_ORIGINS:
        print('Warning: DOOR_ALLOWED_ORIGINS is not set. Any browser origin will be allowed (compatibility mode).')

    with socketserver.TCPServer(("", PORT), UnlockRequestHandler) as httpd:
        print(f"Inventory Hardware Server started at port {PORT}")
        print("Waiting for unlock requests from the Web App...")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
        finally:
            if GPIO_AVAILABLE:
                # Keep relay de-energized on service stop.
                _set_door_pin_low()
                GPIO.cleanup()
