#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import sqlite3
import threading
import time
from urllib.parse import parse_qs, urlparse
import urllib.error
import urllib.request

import RPi.GPIO as GPIO


PORT = int(os.getenv("LED_DOOR_PORT", "8090"))
LED_PIN = int(os.getenv("LED_PIN", "17"))
LED_TRIGGER_SECONDS = float(os.getenv("LED_TRIGGER_SECONDS", "3"))

DOOR_SENSOR_PIN = int(os.getenv("DOOR_SENSOR_PIN", "22"))
DOOR_SENSOR_OPEN_STATE = str(os.getenv("DOOR_SENSOR_OPEN_STATE", "HIGH")).strip().upper()
DOOR_SENSOR_PULL = str(os.getenv("DOOR_SENSOR_PULL", "UP")).strip().upper()
DOOR_SENSOR_BOUNCETIME_MS = int(float(os.getenv("DOOR_SENSOR_BOUNCE_SECONDS", "0.08")) * 1000)

SUPABASE_URL = str(os.getenv("SUPABASE_URL", "")).strip()
SUPABASE_PI_RPC_KEY = str(os.getenv("SUPABASE_PI_RPC_KEY", "")).strip()
KIOSK_ID = str(os.getenv("KIOSK_ID", "KIOSK-001")).strip()
DOOR_SENSOR_ID = str(os.getenv("DOOR_SENSOR_ID", "door-1")).strip()

DOOR_QUEUE_DB_PATH = str(
    os.getenv("DOOR_QUEUE_DB_PATH", "/var/lib/inventory-door/led-door-queue.db")
).strip()
DOOR_QUEUE_BATCH_SIZE = int(os.getenv("DOOR_QUEUE_BATCH_SIZE", "40"))
DOOR_QUEUE_FLUSH_SECONDS = float(os.getenv("DOOR_QUEUE_FLUSH_SECONDS", "0.6"))
DOOR_QUEUE_RETENTION_DAYS = float(os.getenv("DOOR_QUEUE_RETENTION_DAYS", "7"))
DOOR_HEARTBEAT_SECONDS = float(os.getenv("DOOR_HEARTBEAT_SECONDS", "60"))
DOOR_RPC_TIMEOUT_SECONDS = float(os.getenv("DOOR_RPC_TIMEOUT_SECONDS", "8"))
DOOR_RPC_MAX_BACKOFF_SECONDS = float(os.getenv("DOOR_RPC_MAX_BACKOFF_SECONDS", "30"))
DOOR_RPC_ENDPOINT = str(os.getenv("DOOR_RPC_ENDPOINT", "")).strip()
DOOR_EVENT_SOURCE = str(os.getenv("DOOR_EVENT_SOURCE", "LED_Door.py")).strip() or "LED_Door.py"
DOOR_EVENT_METHOD = str(os.getenv("DOOR_EVENT_METHOD", "sensor_edge")).strip() or "sensor_edge"
DOOR_UNLOCK_CONTEXT_WINDOW_SECONDS = float(
    os.getenv("DOOR_UNLOCK_CONTEXT_WINDOW_SECONDS", "30")
)


def _utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000000):06d}Z"


class LocalQueue:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS event_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    local_seq INTEGER NOT NULL,
                    payload TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    last_error TEXT
                );

                CREATE TABLE IF NOT EXISTS kv_state (
                    k TEXT PRIMARY KEY,
                    v TEXT NOT NULL
                );
                """
            )

    def get_state(self, key: str, default: str = "") -> str:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute("SELECT v FROM kv_state WHERE k = ?", (key,)).fetchone()
                return row["v"] if row else default

    def set_state(self, key: str, value: str):
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    """
                    INSERT INTO kv_state (k, v) VALUES (?, ?)
                    ON CONFLICT(k) DO UPDATE SET v = excluded.v
                    """,
                    (key, value),
                )
                conn.commit()

    def enqueue(self, local_seq: int, payload: dict):
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO event_queue (local_seq, payload, created_at) VALUES (?, ?, ?)",
                    (local_seq, json.dumps(payload, separators=(",", ":")), time.time()),
                )
                conn.commit()

    def fetch_batch(self, limit: int):
        with self._lock:
            with self._connect() as conn:
                return conn.execute(
                    "SELECT id, payload FROM event_queue ORDER BY id ASC LIMIT ?",
                    (max(1, limit),),
                ).fetchall()

    def ack(self, ids):
        if not ids:
            return
        placeholders = ",".join(["?"] * len(ids))
        with self._lock:
            with self._connect() as conn:
                conn.execute(f"DELETE FROM event_queue WHERE id IN ({placeholders})", ids)
                conn.commit()

    def mark_error(self, ids, message: str):
        if not ids:
            return
        placeholders = ",".join(["?"] * len(ids))
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    f"UPDATE event_queue SET last_error = ? WHERE id IN ({placeholders})",
                    [message] + ids,
                )
                conn.commit()

    def size(self) -> int:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute("SELECT COUNT(*) AS c FROM event_queue").fetchone()
                return int(row["c"])

    def prune(self, retention_days: float) -> int:
        cutoff = time.time() - max(0.1, retention_days) * 86400.0
        with self._lock:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM event_queue WHERE created_at < ?", (cutoff,))
                conn.commit()
                return cur.rowcount


class Telemetry:
    def __init__(self):
        self.queue = LocalQueue(DOOR_QUEUE_DB_PATH)
        self.stop_event = threading.Event()
        self.lock = threading.Lock()

        self.seq = int(self.queue.get_state("seq", "0") or "0")
        self.door_position = "unknown"
        self.open_started_at = self.queue.get_state("open_started_at", "")
        self.open_started_mono = time.monotonic() if self.open_started_at else None
        open_seq = self.queue.get_state("open_local_seq", "")
        self.open_local_seq = int(open_seq) if open_seq else None

        self.last_actor_user_id = None
        self.last_unlock_job_id = None
        self.last_context_at = 0.0
        self.last_successful_upload_at = ""
        self.last_rpc_error = ""
        self.last_rpc_error_at = ""

    def _next_seq(self) -> int:
        self.seq += 1
        self.queue.set_state("seq", str(self.seq))
        return self.seq

    def record_context(self, actor_user_id=None, unlock_job_id=None):
        with self.lock:
            if actor_user_id:
                self.last_actor_user_id = str(actor_user_id)
            if unlock_job_id:
                self.last_unlock_job_id = str(unlock_job_id)
            self.last_context_at = time.time()

    def _current_context(self):
        with self.lock:
            if (time.time() - self.last_context_at) > DOOR_UNLOCK_CONTEXT_WINDOW_SECONDS:
                return None, None
            return self.last_actor_user_id, self.last_unlock_job_id

    def _enqueue_event(self, event_type: str, metadata=None, session=None):
        actor_user_id, unlock_job_id = self._current_context()
        merged_metadata = {
            "transport": "rest-rpc",
            "method": DOOR_EVENT_METHOD,
            **(metadata or {}),
        }
        event = {
            "local_seq": self._next_seq(),
            "event_type": event_type,
            "event_ts": _utc_now_iso(),
            "source": DOOR_EVENT_SOURCE,
            "unlock_job_id": unlock_job_id,
            "actor_user_id": actor_user_id,
            "metadata": merged_metadata,
        }
        if session is not None:
            event["session"] = session
        self.queue.enqueue(int(event["local_seq"]), event)
        return event

    def on_door_open(self, initial_state=False):
        if self.open_started_mono is not None:
            return
        event = self._enqueue_event("open", metadata={"initial_state": bool(initial_state)})
        self.open_started_mono = time.monotonic()
        self.open_started_at = event["event_ts"]
        self.open_local_seq = int(event["local_seq"])
        self.queue.set_state("open_started_at", self.open_started_at)
        self.queue.set_state("open_local_seq", str(self.open_local_seq))
        self.door_position = "open"
        print(f"[telemetry] open seq={event['local_seq']}")

    def on_door_close(self):
        if self.open_started_mono is None or not self.open_started_at:
            self.door_position = "closed"
            return
        duration_ms = int(max(0.0, time.monotonic() - self.open_started_mono) * 1000.0)
        actor_user_id, unlock_job_id = self._current_context()
        close_event = {
            "local_seq": self._next_seq(),
            "event_type": "close",
            "event_ts": _utc_now_iso(),
            "source": DOOR_EVENT_SOURCE,
            "unlock_job_id": unlock_job_id,
            "actor_user_id": actor_user_id,
            "metadata": {
                "transport": "rest-rpc",
                "method": DOOR_EVENT_METHOD,
            },
            "session": {
                "open_local_seq": self.open_local_seq,
                "close_local_seq": None,
                "opened_at": self.open_started_at,
                "closed_at": _utc_now_iso(),
                "duration_ms": duration_ms,
                "metadata": {},
            },
        }
        close_event["session"]["close_local_seq"] = int(close_event["local_seq"])
        self.queue.enqueue(int(close_event["local_seq"]), close_event)

        self.open_started_mono = None
        self.open_started_at = ""
        self.open_local_seq = None
        self.queue.set_state("open_started_at", "")
        self.queue.set_state("open_local_seq", "")
        self.door_position = "closed"
        print(f"[telemetry] close seq={close_event['local_seq']} duration_ms={duration_ms}")

    def on_sensor_transition(self):
        raw = GPIO.input(DOOR_SENSOR_PIN)
        open_is_high = DOOR_SENSOR_OPEN_STATE in {"HIGH", "1", "TRUE", "OPEN"}
        new_position = "open" if ((raw == GPIO.HIGH) == open_is_high) else "closed"
        if new_position == self.door_position:
            return
        if new_position == "open":
            self.on_door_open()
        else:
            self.on_door_close()

    def emit_heartbeat(self):
        self._enqueue_event("heartbeat", metadata={"queue_depth": self.queue.size()})

    def _rpc_send(self, events):
        endpoint = DOOR_RPC_ENDPOINT or f"{SUPABASE_URL.rstrip('/')}/rest/v1/rpc/log_door_events_batch"
        body = json.dumps(
            {
                "p_kiosk_id": KIOSK_ID,
                "p_sensor_id": DOOR_SENSOR_ID,
                "p_events": events,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        req = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "apikey": SUPABASE_PI_RPC_KEY,
                "Authorization": f"Bearer {SUPABASE_PI_RPC_KEY}",
                "User-Agent": "inventory-led-door/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=max(2.0, DOOR_RPC_TIMEOUT_SECONDS)) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            try:
                payload = error.read().decode("utf-8", errors="replace").strip()[:400]
            except Exception:
                payload = ""
            detail = f"HTTP {error.code} {error.reason}"
            if payload:
                detail += f" body={payload}"
            raise RuntimeError(detail) from error

    def sender_loop(self):
        if not SUPABASE_URL or not SUPABASE_PI_RPC_KEY:
            print("[telemetry] SUPABASE_URL/SUPABASE_PI_RPC_KEY missing; upload disabled")
            while not self.stop_event.is_set():
                self.stop_event.wait(1.0)
            return

        backoff = 0.5
        max_backoff = max(1.0, DOOR_RPC_MAX_BACKOFF_SECONDS)
        last_prune = 0.0
        while not self.stop_event.is_set():
            try:
                now = time.time()
                if (now - last_prune) > 3600:
                    pruned = self.queue.prune(DOOR_QUEUE_RETENTION_DAYS)
                    if pruned:
                        print(f"[telemetry] pruned {pruned} old queue rows")
                    last_prune = now

                rows = self.queue.fetch_batch(DOOR_QUEUE_BATCH_SIZE)
                if not rows:
                    self.stop_event.wait(DOOR_QUEUE_FLUSH_SECONDS)
                    continue

                ids = [int(r["id"]) for r in rows]
                events = [json.loads(r["payload"]) for r in rows]
                result = self._rpc_send(events)
                self.queue.ack(ids)
                backoff = 0.5
                with self.lock:
                    self.last_successful_upload_at = _utc_now_iso()
                    self.last_rpc_error = ""
                    self.last_rpc_error_at = ""
                print(
                    f"[telemetry] sent count={len(events)} queue={self.queue.size()} result={result}"
                )
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                self.queue.mark_error(ids if "ids" in locals() else [], str(error))
                with self.lock:
                    self.last_rpc_error = str(error)
                    self.last_rpc_error_at = _utc_now_iso()
                wait_for = min(backoff, max_backoff)
                print(f"[telemetry] send failed ({error}); retrying in {wait_for:.1f}s")
                self.stop_event.wait(wait_for)
                backoff = min(backoff * 2.0, max_backoff)
            except Exception as error:
                self.queue.mark_error(ids if "ids" in locals() else [], str(error))
                with self.lock:
                    self.last_rpc_error = str(error)
                    self.last_rpc_error_at = _utc_now_iso()
                wait_for = min(backoff, max_backoff)
                print(f"[telemetry] sender error ({error}); retrying in {wait_for:.1f}s")
                self.stop_event.wait(wait_for)
                backoff = min(backoff * 2.0, max_backoff)

    def heartbeat_loop(self):
        while not self.stop_event.is_set():
            self.stop_event.wait(max(5.0, DOOR_HEARTBEAT_SECONDS))
            if self.stop_event.is_set():
                return
            self.emit_heartbeat()

    def start(self):
        threading.Thread(target=self.sender_loop, daemon=True).start()
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()

    def diagnostics(self):
        with self.lock:
            return {
                "last_successful_upload_at": self.last_successful_upload_at or None,
                "last_rpc_error": self.last_rpc_error or None,
                "last_rpc_error_at": self.last_rpc_error_at or None,
            }


telemetry = Telemetry()
led_lock = threading.Lock()


def pulse_led(seconds: float):
    with led_lock:
        GPIO.output(LED_PIN, GPIO.HIGH)
        print("LED ON")
        time.sleep(max(0.05, seconds))
        GPIO.output(LED_PIN, GPIO.LOW)
        print("LED OFF")


class RequestHandler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict):
        self.send_response(status)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/trigger":
            query = parse_qs(parsed.query)
            user_id = (query.get("userId") or [None])[0]
            unlock_job_id = (query.get("unlockJobId") or [None])[0]
            telemetry.record_context(actor_user_id=user_id, unlock_job_id=unlock_job_id)

            threading.Thread(target=pulse_led, args=(LED_TRIGGER_SECONDS,), daemon=True).start()
            self._json(
                200,
                {
                    "status": "success",
                    "message": f"LED triggered for {LED_TRIGGER_SECONDS}s",
                    "door_position": telemetry.door_position,
                    "queue_depth": telemetry.queue.size(),
                },
            )
            return

        if parsed.path == "/status":
            self._json(
                200,
                {
                    "status": "success",
                    "port": PORT,
                    "door_position": telemetry.door_position,
                    "queue_depth": telemetry.queue.size(),
                    "supabase_enabled": bool(SUPABASE_URL and SUPABASE_PI_RPC_KEY),
                },
            )
            return

        if parsed.path == "/telemetry":
            diagnostics = telemetry.diagnostics()
            self._json(
                200,
                {
                    "status": "success",
                    "kiosk_id": KIOSK_ID,
                    "sensor_id": DOOR_SENSOR_ID,
                    "supabase_enabled": bool(SUPABASE_URL and SUPABASE_PI_RPC_KEY),
                    "queue_depth": telemetry.queue.size(),
                    **diagnostics,
                },
            )
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/holdopen":
            content_length = int(self.headers.get("Content-Length", 0))
            try:
                body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(body) if body else {}
            except (ValueError, UnicodeDecodeError) as e:
                self._json(400, {"status": "error", "message": f"Invalid JSON: {e}"})
                return

            actor = payload.get("actor", "SYSTEM")
            reason = payload.get("reason", "api-holdopen")
            unlock_job_id = payload.get("unlockJobId")

            telemetry.record_context(actor_user_id=actor, unlock_job_id=unlock_job_id)

            threading.Thread(target=pulse_led, args=(LED_TRIGGER_SECONDS,), daemon=True).start()
            self._json(
                200,
                {
                    "status": "success",
                    "message": f"Hold-open triggered for {LED_TRIGGER_SECONDS}s (reason: {reason})",
                    "door_position": telemetry.door_position,
                    "queue_depth": telemetry.queue.size(),
                },
            )
            return

        self.send_response(404)
        self.end_headers()


def configure_gpio():
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(LED_PIN, GPIO.OUT)
    GPIO.output(LED_PIN, GPIO.LOW)

    pull = GPIO.PUD_OFF
    if DOOR_SENSOR_PULL == "UP":
        pull = GPIO.PUD_UP
    elif DOOR_SENSOR_PULL == "DOWN":
        pull = GPIO.PUD_DOWN

    GPIO.setup(DOOR_SENSOR_PIN, GPIO.IN, pull_up_down=pull)

    def sensor_callback(_channel):
        telemetry.on_sensor_transition()

    GPIO.add_event_detect(
        DOOR_SENSOR_PIN,
        GPIO.BOTH,
        callback=sensor_callback,
        bouncetime=max(10, DOOR_SENSOR_BOUNCETIME_MS),
    )

    # Prime initial state tracking at startup.
    raw = GPIO.input(DOOR_SENSOR_PIN)
    open_is_high = DOOR_SENSOR_OPEN_STATE in {"HIGH", "1", "TRUE", "OPEN"}
    is_open = (raw == GPIO.HIGH) == open_is_high
    telemetry.door_position = "closed"
    if is_open:
        telemetry.on_door_open(initial_state=True)
    else:
        telemetry.door_position = "closed"


def run(server_class=HTTPServer, handler_class=RequestHandler):
    configure_gpio()
    telemetry.start()

    server_address = ("", PORT)
    httpd = server_class(server_address, handler_class)
    print(f"Server running on port {PORT}...")
    print(
        f"Telemetry enabled={bool(SUPABASE_URL and SUPABASE_PI_RPC_KEY)} pin={DOOR_SENSOR_PIN}"
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        telemetry.stop_event.set()
        GPIO.cleanup()
        httpd.server_close()
        print("Server stopped.")


if __name__ == "__main__":
    run()
