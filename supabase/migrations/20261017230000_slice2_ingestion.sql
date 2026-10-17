BEGIN;
-- Opaque random bearer credentials. Store only SHA-256 digests; never public keys.
CREATE TABLE public.device_credentials (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 device_id text NOT NULL REFERENCES public.devices(id),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
ALTER TABLE public.device_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_credentials FROM anon, authenticated;
CREATE INDEX device_credentials_device ON public.device_credentials(device_id);
CREATE TABLE public.device_health (
 device_id text PRIMARY KEY, room_id text NOT NULL,
 sent_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sensor_status text NOT NULL CHECK(sensor_status IN ('connected','degraded','disconnected')),
 model_status text NOT NULL CHECK(model_status IN ('loading','ready','error')),
 last_valid_frame_at timestamptz, outbox_depth bigint NOT NULL CHECK(outbox_depth >= 0),
 dropped_event_count bigint NOT NULL CHECK(dropped_event_count >= 0), clock_synced boolean NOT NULL,
 FOREIGN KEY(device_id,room_id) REFERENCES public.devices(id,room_id)
);
ALTER TABLE public.device_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_health FROM anon, authenticated;
-- This metadata projection is sufficient for Realtime invalidation and scoped REST refetch.
ALTER TABLE public.incidents ADD COLUMN facility_id text;
UPDATE public.incidents i SET facility_id = r.facility_id FROM public.rooms r WHERE r.id=i.room_id;
ALTER TABLE public.incidents ALTER COLUMN facility_id SET NOT NULL;
ALTER TABLE public.incidents ADD CONSTRAINT incident_facility_room FOREIGN KEY(room_id,facility_id) REFERENCES public.rooms(id,facility_id);
CREATE INDEX incidents_facility_history ON public.incidents(facility_id,created_at DESC,id DESC);
-- Existing incident SELECT grant, room/membership RLS and publication are retained.
COMMIT;
