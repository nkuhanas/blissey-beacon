# QNX transport verification — October 17, 2026 (Pacific)

Scope: device transport on the actual Raspberry Pi 5; inference and hosted event
persistence are separate gates. No hosted synthetic incident was created.

## Device and runtime

- `uname -a`: QNX 8.0.0, build `2026/06/05-16:21:14EDT`, RaspberryPi5,
  `aarch64le`.
- Python 3.14.0; SQLite 3.51.0; OpenSSL 3.6.3; `websockets==15.0.1`
  installed from the pure-Python wheel into the client-local `vendor` directory.
- Client copied to `/data/home/qnxuser/blissey-beacon/transport`.
- Shared fixtures/schemas copied separately to
  `/data/home/qnxuser/blissey-beacon/checks/qnx-contracts` for isolated tests.

## Executed checks

- All 16 Python tests passed on macOS and on the actual QNX Pi (QNX test duration
  4.942 seconds). Tests cover the shared event fixtures and authoritative message
  property shapes; native rules are not a claim of complete JSON Schema engine
  equivalence.
- Actual QNX SQLite restart replay, overflow/expiration loss accounting,
  quarantine, old-ACK payload matching and sender file locking passed.
- Actual QNX loopback WebSocket tests passed for lost ACK/reconnect with identical
  replay and duplicate ACK, terminal rejection, 401 authentication stop, health
  during ACK waits, unmatched ACK and oversized reply rejection.
- Actual QNX TLS tests rejected an untrusted certificate and hostname mismatch,
  and accepted the local test CA only when explicitly trusted.
- The actual Pi reached Railway's WSS route with system CA and hostname
  verification enabled. A fresh random invalid credential received HTTP **401**;
  no health or inference messages were sent. This proves network/TLS/upgrade-route
  reachability and rejection, not authenticated ingestion.
- Prior HTTPS `/healthz` returned HTTP 200 with TLS verification result 0.
- Prior live USB check at 921600 baud captured 500 framed int8 CSI records over
  eight seconds, one source on channel 6, no malformed records or Wi-Fi retry
  warnings. Declared 384/transmitted 128 byte records reflect the provided
  firmware's LLTF-only output. This sample does not establish sustained sensing,
  transmitter identity, packet-loss rate, preprocessing parity or model accuracy.

The QNX test log is stored on the device at
`/data/home/qnxuser/blissey-beacon/logs/transport-tests.log`.

## Remaining acceptance gates

- The Pi has been configured with user-supplied device ID `1` and room ID `101`,
  and an exclusive mode-600 random token was generated on the Pi. Backend mapping
  and token registration remain pending; configuration and token are absent from Git.
  A precondition-checked registration SQL file is prepared on the Pi at
  `/data/home/qnxuser/blissey-beacon/config/device-registration.sql`. It refuses to
  invent a missing room or reassign an existing device. It has not been executed.
- Verify an authenticated hosted connection and honest health persistence.
- With explicit permission to create a fictional hosted incident, verify an
  accepted ACK, duplicate ACK with the same incident ID, operator REST read and
  Realtime visibility. Do not enable outbound calls as part of this check.
- Integrate Chloe's grouped-event producer and atomic health snapshots; validate
  exported-model outputs and complete window/normalization/operator parity.
- Verify clock synchronization service, sustained capture/reconnect/reboot,
  real power interruption durability and the process-manager startup policy.
- Confirm sponsor AI-module eligibility separately. A basic TFLite addition
  fixture ran on QNX, which doesn't prove the trained CNN's compatibility.
