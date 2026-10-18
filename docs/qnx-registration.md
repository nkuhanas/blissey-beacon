# Pi WebSocket registration

Emilia reported the Pi configured with device ID `"1"` and room ID `"101"`.
Use these exact **strings** in inference events and device-health messages.
They are database IDs, not aliases for `pi_102` or `room_102`.

On 2026-10-18 UTC, the hosted Supabase database initially contained only
`pi_102 → room_102`. Administration created and read back the following additional
assignment at the user's request:

| Record | Value |
| --- | --- |
| Facility ID | `demo_facility` |
| Room ID / label | `101` / Room 101 |
| Device ID | `1` |
| Assigned device room | `101` |

The existing simulator records were preserved. No patient, family contact or
spatial layout was invented for Room 101. Ingestion does not require a patient;
family-call previews require an incident-time patient assignment and consented
contact, so that association remains a separate setup step.

## Credential handoff and registration

The supplied `PI_DEVICE_TOKEN_SHA256` was registered on 2026-10-18 UTC for device
`1`. The backend's actual credential lookup resolved it to room `101` in
`demo_facility`, with an active, unrevoked credential. The registration did not
create an inference event or authorize a notification. The raw token was not
needed or stored in repository source. Actual Pi/QNX WSS acceptance remains
unverified; server-side lookup alone is not a hardware integration test.

For future registration or rotation, transfer prepared SQL into ignored `.supabase-test/pi-registration.sql`, or
provide the existing Pi token as local-only `PI_DEVICE_TOKEN` (or its digest as
`PI_DEVICE_TOKEN_SHA256`) in ignored `.env.deploy.local`. Never paste a token into
chat, commit it, print it, or put it in an event or URL. Those PI_ inputs are
administrative handoff values, not frontend or backend runtime configuration.

Review prepared SQL before running it. Apply registration from a trusted backend
administration environment; QNX must not connect to PostgreSQL directly. The
private `device_credentials` table expects the lowercase, 64-hex-character SHA-256
digest of the exact UTF-8 bearer token, associated with device `1`. This is not a
Supabase JWT, service-role key or public API key. Keep the raw token on the Pi.
Do not reuse the simulator credential or rotate the Pi's token without updating
its configuration. Verify an existing hash belongs to this device and is not
revoked; never move a hash from another device or silently undo revocation.

## Connection and acceptance

Connect using verified TLS to:

```text
wss://api.blissey-beacon.health/api/devices/v1/stream
Authorization: Bearer <the Pi's existing opaque token>
```

Send the canonical seven-field v2 event with `device_id: "1"`, `room_id: "101"`,
`event_type: "inference_result"` and `confidence_scores`. Native numeric JSON IDs
are invalid. Keep a stable event ID and identical payload across retransmission;
only remove it from the local outbox after `event_ack`. Device-health messages use
the separate canonical schema, including the same string IDs; they receive no
inference-event ACK.

After registering the exact hash, verify server-side credential lookup resolves
to `1 → 101 → demo_facility`. Then run the actual Pi/QNX WSS check separately.
A desktop handshake proves only credential acceptance; a desktop synthetic event
must be labeled synthetic and cannot prove QNX or classifier integration. Nothing
in this registration authorizes a call or iMessage.
