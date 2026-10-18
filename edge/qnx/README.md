# QNX device WebSocket client

Implements PROJECT_SPEC sections 14–16, 24 and 26: a Python transport on the Pi
that sends already-grouped v2 inference events to Railway. CSI parsing, windowing,
model loading, thresholds and episode grouping remain the inference producer's
responsibility. This client never turns a score or test tensor into an incident
automatically. There is no laptop intermediary at runtime.

## Protocol and delivery

- Connect to `wss://api.blissey-beacon.health/api/devices/v1/stream`. The device
  token is sent only in `Authorization: Bearer ...`. System CA certificates and
  hostname verification are required. An optional `ca_file` configuration field
  adds an explicit CA bundle; there is no insecure TLS option. Proxies,
  compression and redirects are disabled. Wire logging is disabled to keep
  authentication headers out of logs.
- Validate events against native rules matching the authoritative shapes in
  `packages/contracts/schemas`. Require exactly the seven v2 properties, finite
  scores in `[0,1]`, score sum tolerance `1e-6`, timezone-bearing timestamps and
  matching configured device/room identities. The Python timestamp parser accepts
  calendar-valid RFC3339 timestamps with offsets, excluding leap-second notation.
  The producer emits ordinary UTC timestamps. Shared valid/invalid fixtures run in
  the native test suite; this is distinct from complete schema equivalence.
- Persist an immutable JSON payload and stable `event_id` in SQLite **before**
  sending. Use SQLite rollback journals, `synchronous=FULL`, and one in-flight
  event. Delete only on a matching `accepted` or `duplicate` durable ACK, including
  payload matching to prevent an old ACK deleting a replacement after overflow.
  A TCP write or socket close is never evidence of persistence.
- ACK timeout is 10 seconds. Disconnects and retryable backend errors retain the
  payload for full-jitter exponential reconnect delay, capped at 30 seconds.
  Handshake 401/403, credential revocation and identity mismatch stop the process
  for operator repair. A non-retryable event rejection quarantines its payload in
  the same bounded database and increments the persistent loss count; it isn't
  automatically resent. Uncorrelated non-retryable errors stop the sender.
- Outbox bounds are 1,000 total pending/quarantined events and 24 hours since local
  enqueue. Expiration and oldest-first overflow visibly increment loss counts.
  Already-counted quarantined losses aren't counted twice. Age uses wall-clock
  time; clock synchronization must be verified separately on the Pi. This adopts
  the spec's proposed MVP bounds as concrete client defaults. Monitor free space
  and SD-card durability; a full/persistence-failing disk causes an explicit error.
- Send `device_health` immediately and every 10 seconds, including during ACK
  waits; health doesn't receive event ACKs. Use WebSocket ping/pong every 15
  seconds with a 10-second timeout. Incoming/outgoing JSON is limited to 16 KiB;
  the receive buffer is bounded to four frames. Unknown/malformed/binary replies
  and unmatched ACKs never remove queue entries.
- A sender lock prevents two transport processes from delivering one outbox
  concurrently. Separate producer processes can enqueue via SQLite transactions.
  Outboxes are bound to a device/room pair; reassignment requires a separate
  database and explicit handling of the prior queue.

## Install on QNX

Requires Python 3.10+, `ssl`, `sqlite3`, `fcntl`, writable persistent storage and
the pinned pure-Python WebSocket wheel. Python and QNX keep independent tooling
from the Node/pnpm Docker workspaces. Run as `qnxuser`, not root.

Copy this directory to `/data/home/qnxuser/blissey-beacon/transport`. Then:

```sh
cd /data/home/qnxuser/blissey-beacon/transport
python3 -m pip install --only-binary=:all: --target ./vendor -r requirements.txt
mkdir -p ../config ../outbox ../logs
chmod 700 ../config ../outbox ../logs
cp config.example.json ../config/device.json
```

Set `device_id` and `room_id` to the provisioned device assignment. Save the
existing scoped device token in `../config/device-token` with mode `600` using
your secure provisioning workflow. Never paste tokens into shell command lines,
URLs, event files, logs, commits, or chat. Backend provisioning is documented in
`docs/deployment.md`; this client has no database or provider-management keys.
The example IDs are examples, not evidence of a valid provisioned credential.

All paths in the config resolve relative to its location. No secret is stored
inside the example JSON. Missing/insecure/invalid token files stop startup.

```sh
sh run-client.sh /data/home/qnxuser/blissey-beacon/config/device.json
```

SIGINT/SIGTERM stop gracefully; unacknowledged events remain queued. A process
manager must **not** endlessly restart exit code 2 (credential/configuration
repair) or exit code 3 (local storage/configuration error). No boot files or
automatic restart policy are installed by this slice. Verify and coordinate the
driver, inference producer and transport startup before enabling boot launch.

## Inference producer handoff

After temporal confirmation/grouping, assign one stable ID to the episode and
enqueue its seven-field event. Never create a new ID for a retry. The transport
doesn't mutate detection time or scores. Prefer in-process enqueue from the
inference worker; the CLI also accepts a bounded event JSON file:

```sh
PYTHONPATH=vendor:. python3 -m blissey_qnx --config ../config/device.json enqueue --event-file /path/to/confirmed-episode.json
PYTHONPATH=vendor:. python3 -m blissey_qnx --config ../config/device.json status
```

```python
from blissey_qnx.outbox import Outbox

outbox = Outbox("/data/home/qnxuser/blissey-beacon/outbox/events.sqlite3", device_id, room_id)
try:
    outbox.enqueue(confirmed_episode)  # Already grouped; ID and timestamp are frozen.
finally:
    outbox.close()
```

`enqueue` rejects changed payloads reusing an ID while retained. A duplicate
identical enqueue is idempotent. Expired/evicted or previously acknowledged IDs
remain subject to the backend's durable deduplication rules. A producer must not
reuse an episode ID for new facts. After enqueue returns, the SQLite commit has
completed. Handle any exception as failed persistence; don't claim delivery.

The inference process must atomically replace the configured health file at least
every 10 seconds, using a temporary file plus `os.replace` after flushing. It has
exactly these five fields:

```json
{
  "updated_at": "2026-10-18T04:00:00Z",
  "sensor_status": "connected",
  "model_status": "ready",
  "last_valid_frame_at": "2026-10-18T04:00:00Z",
  "clock_synced": false
}
```

Use real current timestamps and real states. Do not copy that illustrative ready
snapshot into a running device. A missing file reports disconnected/loading,
null last frame and unverified clock. Invalid snapshots, snapshots older than 30
seconds or future snapshots report disconnected/error. A connected sensor with
no recent valid frame becomes degraded. Model load failure must report error;
mere installation of TFLite never establishes model readiness. Clock accuracy and
clock-service synchronization are distinct; set `clock_synced` only from verified
clock-service status. Sensor/model health and the transport's outbox/loss counts
are reported separately.

## Tests and verification boundaries

From the repository root, in an independent Python environment:

```sh
python3 -m venv /tmp/blissey-qnx-tests
/tmp/blissey-qnx-tests/bin/pip install -r edge/qnx/requirements.txt
PYTHONPATH=edge/qnx /tmp/blissey-qnx-tests/bin/python -m unittest discover -s edge/qnx/tests -v
```

Tests use loopback WebSocket servers and temporary databases/certificates. They
cover canonical fixtures, queue restart/expiry/overflow, quarantine, lost ACK and
exact duplicate replay, health during ACK timeout, authentication rejection,
message size/ACK correlation, CA validation and hostname mismatch. No hosted
incident, notification or provider mutation is created. Local plain WS needs the
explicit `--allow-local-ws` flag and a loopback host.

For QNX, run these same tests with a copy of the repository's shared contract
fixtures/schemas (`BLISSEY_REPO` may identify that copy). Loopback testing on QNX
proves the Python transport and local persistence paths; it does not establish
Railway/Supabase persistence. A production synthetic incident requires explicit
authorization to create it, a valid device credential and separate evidence of
accepted ACK, duplicate ACK/same incident, operator REST visibility and Realtime.
No outbound call is authorized by an ingestion ACK.

The existing inference test only executes a small official TensorFlow addition
fixture; Chloe's CNN operator support, golden-output parity, sponsor module
eligibility and sustained throughput remain separate acceptance gates. This
client carries structured events/health; CSI data stays local to the Pi.
