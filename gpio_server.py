#!/usr/bin/env python3
import http.server
import socketserver
import json
import time

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
# ---------------------

if GPIO_AVAILABLE:
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(DOOR_UNLOCK_PIN, GPIO.OUT)
    GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)

class UnlockRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

    def do_POST(self):
        """Handle the unlock request from the frontend app."""
        if self.path == '/unlock':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                item_id = data.get('itemId', 'Unknown')
                item_name = data.get('itemName', 'Unknown')
                category = data.get('category', 'Unknown')
                
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Unlock request received!")
                print(f"Item: {item_name} ({item_id}) - Category: {category}")
                
                # Trigger GPIO Pins
                if GPIO_AVAILABLE:
                    print(f"Unlocking door (Pin {DOOR_UNLOCK_PIN}) goes HIGH...")
                    GPIO.output(DOOR_UNLOCK_PIN, GPIO.HIGH)
                    time.sleep(UNLOCK_DURATION)
                    print(f"Locking door (Pin {DOOR_UNLOCK_PIN}) goes LOW...")
                    GPIO.output(DOOR_UNLOCK_PIN, GPIO.LOW)
                else:
                    print(f"SIMULATION: Door unlocked for {UNLOCK_DURATION} seconds. (GPIO not available)")
                    time.sleep(UNLOCK_DURATION)
                    print(f"SIMULATION: Door re-locked.")
                
                # Send Success Response
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'success', 'message': f'Door unlocked for {UNLOCK_DURATION}s'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except json.JSONDecodeError:
                self.send_response(400)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': 'Invalid JSON format'}
                self.wfile.write(json.dumps(response).encode('utf-8'))
            except Exception as e:
                print(f"Error handling request: {e}")
                self.send_response(500)
                self.send_header('Content-type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                response = {'status': 'error', 'message': str(e)}
                self.wfile.write(json.dumps(response).encode('utf-8'))
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
