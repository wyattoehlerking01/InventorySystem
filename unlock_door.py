#!/usr/bin/env python3
"""Pulse a GPIO relay to unlock the door.

Environment variables:
- DOOR_RELAY_PIN: BCM GPIO pin number (default: 17)
- DOOR_UNLOCK_PULSE_SECONDS: pulse duration in seconds (default: 0.7)
- DOOR_RELAY_ACTIVE_HIGH: relay logic level, true/false (default: false)
"""

import os
import sys
import time


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def main() -> int:
    pin = int(os.getenv("DOOR_RELAY_PIN", "17"))
    pulse_seconds = float(os.getenv("DOOR_UNLOCK_PULSE_SECONDS", "0.7"))
    active_high = _env_bool("DOOR_RELAY_ACTIVE_HIGH", False)

    try:
        from gpiozero import OutputDevice
    except Exception as exc:  # pragma: no cover
        print(f"gpiozero import failed: {exc}", file=sys.stderr)
        return 2

    relay = None
    try:
        relay = OutputDevice(pin, active_high=active_high, initial_value=False)
        relay.on()
        time.sleep(max(0.05, pulse_seconds))
        relay.off()
        print(
            f"Door unlock pulse sent (pin={pin}, pulse_seconds={pulse_seconds}, active_high={active_high})"
        )
        return 0
    except Exception as exc:
        print(f"Door unlock failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if relay is not None:
            try:
                relay.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
