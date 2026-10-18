# ESP32 USB serial at boot (QNX Pi 5)

The USB-only supervisor starts the mentor-supplied `devc-serusb` driver at
921600 baud, raw 8N1, with flow control disabled. It matches Silicon Labs
CP2102 VID `0x10c4` / PID `0xea60` without a fixed bus/device address, so the
driver monitors USB insertions. With one matching board, the port is
`/dev/serusb1`. Multiple CP2102 boards need explicit receiver identification;
do not assume enumeration order identifies the AP receiver.

This does not start inference or the WebSocket sender.

## Installed layout

- `/usr/local/libexec/blissey/blissey-usb.py`: root-owned supervisor, mode 644.
- `/usr/local/libexec/blissey/devc-serusb`: root-owned driver, mode 755.
  The proprietary driver is supplied separately; it is not committed here.
- `/data/.boot/blissey-usb.lock`: singleton lock in QNX's root-only boot state.
- `/data/.boot/blissey-usb.log`: supervisor events, rotated at 128 KiB with
  two backups. No serial payload or credentials are logged.

The supervisor runs the driver in the foreground (`-o nodaemon`) and restarts
it with backoff from 1 to 30 seconds if it exits. Its lock prevents a second
supervisor. Do not independently start another USB driver for the same board.
Stop the supervisor first when maintaining the driver.

## Boot integration

On this QNX Everywhere image, `/system` points to the persistent `/usr`
partition. The existing `/system/etc/startup/post_startup.sh` starts USB.
After backing up that file, add this block before its final `exit 0`:

```sh
# BEGIN BLISSEY USB AUTO-START
# USB-only: no detector, model or network sender is started here.
on -d /usr/bin/python3 -I -B /usr/local/libexec/blissey/blissey-usb.py </dev/null >/dev/null 2>&1
# END BLISSEY USB AUTO-START
```

Install the supervisor and driver into the root-owned directory above before
enabling the hook. Run `sh -n /system/etc/startup/post_startup.sh` before replacing
the startup file. Keep both scripts and their parent directories non-writable
by ordinary users. Never launch a user-writable script or binary as root at boot.
The original startup backup is retained on this Pi under
`/data/.boot/post_startup.before-blissey-usb.*.sh`.

The generic driver binds new insertions, including a receiver plugged in after
boot; actual unplug/replug should still be verified with the intended boards.
Driver termination/restart is tested separately from physical reconnection.
The reader must reopen the port after disconnection (the deployed detector does).
A replaced/reflashed OS image must have this hook reinstalled.

## Verify

```sh
sudo pidin ar | grep -E 'blissey-usb.py|devc-serusb'
ls -l /dev/serusb1
stty < /dev/serusb1
sudo tail -n 20 /data/.boot/blissey-usb.log
```

Verify live CSI with the detector stopped so two readers do not consume the same
stream. Do not turn test packets into hosted incidents.

## Disable / rollback

Remove only the marked block from `post_startup.sh`, validate with `sh -n`,
then send SIGTERM to the supervisor PID shown by `sudo pidin ar`. It terminates
its child driver. Leave unrelated startup changes intact. Restore the saved
whole-file backup only if no subsequent startup edits would be lost.
