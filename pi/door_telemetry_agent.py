#!/usr/bin/env python3
"""Door sensor telemetry agent for Raspberry Pi.

Writes GPIO edge events to a local SQLite queue and flushes batches to
Supabase RPC `log_door_events_batch`.
"""

import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class LocalQueue:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
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

                CREATE INDEX IF NOT EXISTS event_queue_created_idx
                    ON event_queue (created_at);

                CREATE TABLE IF NOT EXISTS kv_state (
                    k TEXT PRIMARY KEY,
                    v TEXT NOT NULL
                );
                """
            )

    def get_state(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute("SELECT v FROM kv_state WHERE k = ?", (key,)).fetchone()
                return row["v"] if row else default

    def set_state(self, key: str, value: str) -> None:
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

    def enqueue(self, local_seq: int, payload: Dict[str, Any]) -> None:
        with self._lock:
            with self._connect() as conn:
                conn.execute(
                    "INSERT INTO event_queue (local_seq, payload, created_at) VALUES (?, ?, ?)",
                    (local_seq, json.dumps(payload, separators=(",", ":")), time.time()),
                )
                conn.commit()

    def fetch_batch(self, limit: int) -> List[sqlite3.Row]:
        with self._lock:
            with self._connect() as conn:
                rows = conn.execute(
                    "SELECT id, local_seq, payload FROM event_queue ORDER BY id ASC LIMIT ?",
                    (max(1, limit),),
                ).fetchall()
                return rows

    def ack_batch(self, ids: List[int]) -> None:
        if not ids:
            return
        placeholders = ",".join(["?"] * len(ids))
        with self._lock:
            with self._connect() as conn:
                conn.execute(f"DELETE FROM event_queue WHERE id IN ({placeholders})", ids)
                conn.commit()

    def mark_error(self, ids: List[int], message: str) -> None:
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

    def prune(self, retention_days: float) -> int:
        cutoff = time.time() - max(0.1, retention_days) * 86400.0
        with self._lock:
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM event_queue WHERE created_at < ?", (cutoff,))
                conn.commit()
                return cur.rowcount

    def size(self) -> int:
        with self._lock:
            with self._connect() as conn:
                row = conn.execute("SELECT COUNT(*) AS c FROM event_queue").fetchone()
                return int(row["c"])


class SupabaseRpcClient:
    def __init__(self, url: str, key: str, timeout_seconds: float = 8.0):
        base = url.rstrip("/")
        self.endpoint = f"{base}/rest/v1/rpc/log_door_events_batch"
        self.key = key
        self.timeout_seconds = max(2.0, timeout_seconds)

    def send_batch(self, kiosk_id: str, sensor_id: str, events: List[Dict[str, Any]]) -> Dict[str, Any]:
        body = json.dumps(
            {
                "p_kiosk_id": kiosk_id,
                "p_sensor_id": sensor_id,
                "p_events": events,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Connection": "keep-alive",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_seconds) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}


class DoorTelemetryAgent:
    def __init__(self) -> None:
        self.kiosk_id = os.getenv("KIOSK_ID", "KIOSK-001").strip()
        self.sensor_id = os.getenv("DOOR_SENSOR_ID", "door-1").strip()
        self.supabase_url = os.getenv("SUPABASE_URL", "").strip()
        self.supabase_key = os.getenv("SUPABASE_PI_RPC_KEY", "").strip()
        self.sensor_pin = int(os.getenv("DOOR_SENSOR_PIN", "22"))
        self.sensor_open_state = os.getenv("DOOR_SENSOR_OPEN_STATE", "HIGH").strip().upper()
        self.sensor_pull = os.getenv("DOOR_SENSOR_PULL", "UP").strip().upper()
        self.bounce_seconds = float(os.getenv("DOOR_SENSOR_BOUNCE_SECONDS", "0.08"))
        self.flush_interval = float(os.getenv("DOOR_QUEUE_FLUSH_SECONDS", "0.6"))
        self.batch_size = int(os.getenv("DOOR_QUEUE_BATCH_SIZE", "40"))
        self.heartbeat_seconds = float(os.getenv("DOOR_HEARTBEAT_SECONDS", "60"))
        self.retention_days = float(os.getenv("DOOR_QUEUE_RETENTION_DAYS", "7"))
        self.unlock_context_window_seconds = float(
            os.getenv("DOOR_UNLOCK_CONTEXT_WINDOW_SECONDS", "30")
        )
        self.unlock_context_file = os.getenv(
            "DOOR_UNLOCK_CONTEXT_FILE", "/var/lib/inventory-door/unlock-context.json"
        )
        self.db_path = os.getenv("DOOR_QUEUE_DB_PATH", "/var/lib/inventory-door/telemetry-queue.db")

        if not self.kiosk_id:
            raise RuntimeError("KIOSK_ID is required")
        if not self.supabase_url:
            raise RuntimeError("SUPABASE_URL is required")
        if not self.supabase_key:
            raise RuntimeError("SUPABASE_PI_RPC_KEY is required")

        self.queue = LocalQueue(self.db_path)
        self.client = SupabaseRpcClient(self.supabase_url, self.supabase_key)
        self.stop_event = threading.Event()

        self.seq = int(self.queue.get_state("seq", "0") or "0")
        self.current_open_started_mono = None
        self.current_open_started_at = self.queue.get_state("open_started_at")
        open_seq = self.queue.get_state("open_local_seq")
        self.current_open_local_seq = int(open_seq) if open_seq else None
        if self.current_open_started_at:
            self.current_open_started_mono = time.monotonic()

    def _next_seq(self) -> int:
        self.seq += 1
        self.queue.set_state("seq", str(self.seq))
        return self.seq

    def _read_unlock_context(self) -> Dict[str, Any]:
        try:
            raw = Path(self.unlock_context_file).read_text(encoding="utf-8")
            context = json.loads(raw)
            ts = float(context.get("recorded_at", 0))
            if (time.time() - ts) > self.unlock_context_window_seconds:
                return {}
            return context
        except Exception:
            return {}

    def _enqueue_event(self, event: Dict[str, Any]) -> None:
        self.queue.enqueue(int(event["local_seq"]), event)

    def _build_base_event(self, event_type: str) -> Dict[str, Any]:
        context = self._read_unlock_context()
        return {
            "local_seq": self._next_seq(),
            "event_type": event_type,
            "event_ts": _utc_now_iso(),
            "source": "pi-agent",
            "unlock_job_id": context.get("unlock_job_id"),
            "actor_user_id": context.get("actor_user_id"),
            "metadata": {},
        }

    def on_open(self) -> None:
        if self.current_open_started_mono is not None:
            return
        event = self._build_base_event("open")
        self.current_open_started_mono = time.monotonic()
        self.current_open_started_at = event["event_ts"]
        self.current_open_local_seq = int(event["local_seq"])
        self.queue.set_state("open_started_at", self.current_open_started_at)
        self.queue.set_state("open_local_seq", str(self.current_open_local_seq))
        self._enqueue_event(event)
        print(f"[telemetry] open edge queued seq={event['local_seq']}")

    def on_close(self) -> None:
        if self.current_open_started_mono is None or not self.current_open_started_at:
            return
        duration_ms = int(max(0.0, time.monotonic() - self.current_open_started_mono) * 1000.0)
        event = self._build_base_event("close")
        event["session"] = {
            "open_local_seq": self.current_open_local_seq,
            "close_local_seq": int(event["local_seq"]),
            "opened_at": self.current_open_started_at,
            "closed_at": event["event_ts"],
            "duration_ms": duration_ms,
            "unlock_job_id": event.get("unlock_job_id"),
            "actor_user_id": event.get("actor_user_id"),
            "metadata": {},
        }
        self._enqueue_event(event)
        print(
            f"[telemetry] close edge queued seq={event['local_seq']} duration_ms={duration_ms}"
        )
        self.current_open_started_mono = None
        self.current_open_started_at = None
        self.current_open_local_seq = None
        self.queue.set_state("open_started_at", "")
        self.queue.set_state("open_local_seq", "")

    def emit_heartbeat(self) -> None:
        event = self._build_base_event("heartbeat")
        event["metadata"] = {"queue_depth": self.queue.size()}
        self._enqueue_event(event)

    def _sender_loop(self) -> None:
        backoff_seconds = 0.5
        last_prune = 0.0
        while not self.stop_event.is_set():
            try:
                now = time.time()
                if (now - last_prune) > 3600:
                    pruned = self.queue.prune(self.retention_days)
                    if pruned > 0:
                        print(f"[telemetry] pruned {pruned} stale queue rows")
                    last_prune = now

                rows = self.queue.fetch_batch(self.batch_size)
                if not rows:
                    self.stop_event.wait(self.flush_interval)
                    continue

                ids = [int(r["id"]) for r in rows]
                events = [json.loads(r["payload"]) for r in rows]
                result = self.client.send_batch(self.kiosk_id, self.sensor_id, events)
                self.queue.ack_batch(ids)
                backoff_seconds = 0.5
                print(
                    "[telemetry] batch sent"
                    f" count={len(events)} queue_depth={self.queue.size()} result={result}"
                )
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                self.queue.mark_error(ids if "ids" in locals() else [], str(error))
                wait_for = min(backoff_seconds, 30.0)
                print(f"[telemetry] send failed: {error}. retry in {wait_for:.1f}s")
                self.stop_event.wait(wait_for)
                backoff_seconds = min(backoff_seconds * 2.0, 30.0)
            except Exception as error:
                self.queue.mark_error(ids if "ids" in locals() else [], str(error))
                wait_for = min(backoff_seconds, 30.0)
                print(f"[telemetry] unexpected sender error: {error}. retry in {wait_for:.1f}s")
                self.stop_event.wait(wait_for)
                backoff_seconds = min(backoff_seconds * 2.0, 30.0)

    def _heartbeat_loop(self) -> None:
        while not self.stop_event.is_set():
            self.stop_event.wait(max(5.0, self.heartbeat_seconds))
            if self.stop_event.is_set():
                return
            self.emit_heartbeat()

    def run(self) -> None:
        sender = threading.Thread(target=self._sender_loop, daemon=True)
        heartbeat = threading.Thread(target=self._heartbeat_loop, daemon=True)
        sender.start()
        heartbeat.start()

        try:
            from signal import pause
            from gpiozero import DigitalInputDevice
        except Exception as error:
            print(f"[telemetry] gpiozero unavailable ({error}); running queue-only mode")
            while not self.stop_event.is_set():
                self.stop_event.wait(1.0)
            return

        pull_up: Optional[bool] = None
        if self.sensor_pull == "UP":
            pull_up = True
        elif self.sensor_pull == "DOWN":
            pull_up = False

        # close the line as quickly as possible; all network I/O runs in sender thread
        sensor = DigitalInputDevice(
            pin=self.sensor_pin,
            pull_up=pull_up,
            bounce_time=max(0.01, self.bounce_seconds),
        )

        open_is_high = self.sensor_open_state in {"HIGH", "1", "TRUE", "OPEN"}
        if open_is_high:
            sensor.when_activated = self.on_open
            sensor.when_deactivated = self.on_close
        else:
            sensor.when_activated = self.on_close
            sensor.when_deactivated = self.on_open

        print(
            "[telemetry] started"
            f" kiosk_id={self.kiosk_id} sensor_id={self.sensor_id} pin={self.sensor_pin}"
            f" queue_db={self.db_path}"
        )

        # capture initial state so first transition is represented correctly
        if bool(sensor.value) == open_is_high:
            self.on_open()

        try:
            while not self.stop_event.is_set():
                pause()
        finally:
            sensor.close()

    def shutdown(self) -> None:
        self.stop_event.set()


def main() -> int:
    agent = DoorTelemetryAgent()
    try:
        agent.run()
    except KeyboardInterrupt:
        pass
    finally:
        agent.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
