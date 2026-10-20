#!/usr/bin/env python3
"""Root-owned QNX CP2102 driver supervisor; no inference or network sender."""
import fcntl
import logging
from logging.handlers import RotatingFileHandler
import os
import signal
import subprocess
import time

DRIVER = "/usr/local/libexec/blissey/devc-serusb"
STATE = "/data/.boot"
COMMAND = [DRIVER, "-o", "nodaemon", "-E", "-F", "-S", "-b921600",
           "-d", "vid=0x10c4,did=0xea60"]

def main():
    if os.geteuid() != 0:
        raise SystemExit("Run as root from the QNX startup hook")
    lock = open(STATE + "/blissey-usb.lock", "a")
    os.chmod(lock.name, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    log = logging.getLogger("blissey-usb")
    log.setLevel(logging.INFO)
    handler = RotatingFileHandler(STATE + "/blissey-usb.log",
                                 maxBytes=131072, backupCount=2)
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    log.addHandler(handler)
    stopping = False
    child = None

    def stop(*_):
        nonlocal stopping
        stopping = True
        if child is not None and child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    delay = 1
    log.info("supervisor started; CP2102 hotplug, 921600 baud")
    while not stopping:
        started = time.monotonic()
        try:
            child = subprocess.Popen(COMMAND, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     close_fds=True)
            log.info("driver started pid=%d", child.pid)
            # Close the signal/Popen race if termination arrived during spawn.
            if stopping:
                child.terminate()
            code = child.wait()
            log.info("driver exited code=%d", code)
        except OSError as exc:
            log.error("driver launch failed: %s", exc)
        finally:
            child = None
        if stopping:
            break
        if time.monotonic() - started > 60:
            delay = 1
        log.info("retrying in %d seconds", delay)
        until = time.monotonic() + delay
        while not stopping and time.monotonic() < until:
            time.sleep(0.2)
        delay = min(delay * 2, 30)
    log.info("supervisor stopped")

if __name__ == "__main__":
    main()
