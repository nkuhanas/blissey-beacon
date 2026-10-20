# QNX fall detector (Model 1 inference producer)

Runs on the Raspberry Pi 5 with QNX, next to the `edge/qnx` transport. It's the **inference producer** that the transport README asks for:
- reads ESP32 CSI from USB serial
- scores 3 s windows with the deployed model
- groups alerts into fall episodes
- hands one seven-field v2 event per episode, plus a health snapshot, to `edge/qnx` (SQLite outbox + health file)

Raw CSI never leaves the Pi.

It uses **only the Python standard library** (3.8+; the Pi runs 3.14): no numpy, scikit-learn, TFLite, ONNX or pickle. The training pipeline computes its features with this same code, so device and training can't drift apart.

## Contents

| Path | Purpose |
|---|---|
| `blissey_edge/csi.py`, `serial_source.py` | Parse ESP32 `CSI_DATA` lines (52 LLTF subcarrier amplitudes); read the USB serial device at 921600 8N1 |
| `blissey_edge/window.py`, `model.py`, `detector.py` | Gap-tolerant quality gate → 424 portable features → model score → alert when 2 of 3 windows pass (5 s cooldown). The transmitter is locked by majority MAC, so stray devices are ignored. |
| `blissey_edge/episodes.py`, `contracts.py` | One event per fall episode (60 s refractory), carrying the strongest voting-window score. A local mirror of the v2 event and health contracts means nothing invalid is ever queued. |
| `blissey_edge/service.py` | The producer process. `--qnx-config` hands events and health to `edge/qnx`; `--replay` and `--no-network` are for testing without hardware. |
| `blissey_edge/selftest.py`, `pi_check.py`, `calibrate.py` | Golden-output parity check; platform check (Python, TLS, clock, serial, live CSI); optional on-site threshold calibration |
| `blissey_edge/ws.py`, `uplink.py`, `outbox.py` | Standalone sender. Not used when `edge/qnx` is installed; don't run both senders for one device. |
| `model.json` | Deployed logistic regression (ADR-038): coefficients, standardization, threshold, alert policy, provenance (Veri job `baae987abfc5`) |
| `golden.json` | Parity fixture: raw packets from one recorded staged fall (public `chloe526/blissey-data@cbff5ec`), plus the scores and alerts the training machine produced |
| `pi/setup_pi.py`, `pi/supervise.py` | Pi install/repair (keeps the existing registered token) and the supervisor that starts the USB-serial driver and runs both processes |
| `tests/test_edge.py` | Unit and integration tests, including a fake backend mirroring `apps/backend/src/ingestion/routes.ts`, checked against `packages/contracts` schemas and fixtures |

## Wiring

- The Pi's USB goes to the **AP receiver** ESP32 (Wi-Fi MAC `20:50:0D:D0:B8:B5`, firmware `blissey-csi-1` active_ap). It prints CSI.
- The **STA transmitter** (`20:50:0D:CC:80:80`) needs power only.
- The CP210x USB-serial driver (`devc-serusb`) creates `/dev/serusb1`. It isn't started at boot yet; `pi/supervise.py` starts it with `sudo`.

## Verify and run (on the Pi)

```sh
cd edge/detector
python3 -m blissey_edge.selftest model.json golden.json            # must print RESULT: PASS
python3 -m blissey_edge.pi_check --serial /dev/serusb1             # ~100 Hz, roles {'AP'}, one dominant source MAC
python3 -m blissey_edge.service --serial /dev/serusb1 --qnx-config /data/home/qnxuser/blissey-beacon/config/device.json
```

The `edge/qnx` transport runs alongside it, using the same `device.json`. Device ID `"1"` and room ID `"101"` come from that config, and the token is read only by the transport.

## Tests (any machine, Python 3.8+)

```sh
python3 -m unittest discover -s edge/detector/tests -v
```

## Status and limits

**Verified on the actual Pi** (QNX 8.0, Python 3.14):
- golden parity
- about 30 ms per window
- about 98 Hz of live AP CSI from `/dev/serusb1`
- events delivered through `edge/qnx` and acknowledged by the hosted backend

**Open:**
- **Saturated live scores.** In a live session, scores sat near 1.0 and alerts fired almost continuously. Before relying on alerts, diagnose this from a quiet capture; packet timing on QNX is the leading suspect.
- **No boot autostart** yet.
- **Unvalidated accuracy.** Model accuracy comes from within-session cross-validation (10/10 staged falls, about 68 false alerts/h): one participant, one session, no held-out session. It is not a validated detection rate.
