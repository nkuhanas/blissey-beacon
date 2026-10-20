"""Wait for the root-managed USB driver without launching a competing driver."""
import glob
import os
import subprocess
import time

WATCHDOG = "/usr/local/libexec/blissey/blissey-usb.py"

def ensure_serial(device, wait=15.0, log=print):
    if os.path.exists(device):
        return True
    if not os.path.isfile(WATCHDOG):
        log("USB boot supervisor missing; install edge/qnx/boot before starting the app")
        return False
    # The root-owned supervisor has a singleton lock. A second invocation exits;
    # a temporary missing node must never launch devc-serusb with default settings.
    result = subprocess.run(
        ["sudo", "-n", "on", "-d", "/usr/bin/python3", "-I", "-B", WATCHDOG],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL)
    if result.returncode:
        log("Unable to start USB supervisor noninteractively; operator repair required")
        return False
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        if os.path.exists(device):
            log("%s ready via managed USB driver" % device)
            return True
        time.sleep(0.25)
    log("%s did not appear; check receiver cable/power. Present: %s" %
        (device, ", ".join(sorted(glob.glob("/dev/serusb*"))) or "none"))
    return False
