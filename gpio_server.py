#!/usr/bin/env python3
import http.server
import socketserver
import json
import time
import os

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
DOOR_UNLOCK_PIN = 17 # Replace with your actual GPIO pin number
UNLOCK_DURATION = 3.0 # Seconds to keep the door unlocked
HOLD_OPEN_MAX_SECONDS = float(os.getenv('HOLD_OPEN_MAX_SECONDS', '0'))
# ---------------------

door_held_open = False
door_hold_started_at = None

if GPIO_AVAILABLE:
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(DOOR_UNLOCK_PIN, GPIO.OUT)
    GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)

def _set_door_pin_high():
    if GPIO_AVAILABLE:
        GPIO.output(DOOR_UNLOCK_PIN, GPIO.HIGH)

def _set_door_pin_low():
    if GPIO_AVAILABLE:
        GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)

def _json_response(handler, status_code, payload):
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.end_headers()
    handler.wfile.write(json.dumps(payload).encode('utf-8'))

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
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

    def do_GET(self):
        """Handle door status checks."""
        _enforce_hold_safety_timeout()

        if self.path != '/status':
            self.send_response(404)
            self.end_headers()
            return

        payload = {
            'status': 'success',
            'held_open': door_held_open,
            'held_open_seconds': round(_get_hold_elapsed_seconds(), 3),
            'gpio_available': GPIO_AVAILABLE,
            'unlock_duration_seconds': UNLOCK_DURATION,
            'hold_open_max_seconds': HOLD_OPEN_MAX_SECONDS
        }
        _json_response(self, 200, payload)

    def do_POST(self):
        """Handle the unlock request from the frontend app."""
        global door_held_open, door_hold_started_at

        _enforce_hold_safety_timeout()

        if self.path in ['/unlock', '/hold-open', '/release']:
            try:
                data = _read_json_body(self)
                item_id = data.get('itemId', 'Unknown')
                item_name = data.get('itemName', 'Unknown')
                category = data.get('category', 'Unknown')
                reason = data.get('reason', 'No reason provided')
                
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
    with socketserver.TCPServer(("", PORT), UnlockRequestHandler) as httpd:
        print(f"Inventory Hardware Server started at port {PORT}")
        print("Waiting for unlock requests from the Web App...")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
        finally:
            if GPIO_AVAILABLE:
                GPIO.cleanup()
