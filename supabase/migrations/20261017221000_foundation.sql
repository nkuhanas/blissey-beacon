-- Supabase provides auth.users, auth.uid(), anon/authenticated roles and publication.
BEGIN;
CREATE TABLE public.facilities (id text PRIMARY KEY, label text NOT NULL);
CREATE TABLE public.facility_memberships (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 facility_id text NOT NULL REFERENCES public.facilities(id),
 PRIMARY KEY (user_id, facility_id)
);
CREATE TABLE public.rooms (
 id text PRIMARY KEY, facility_id text NOT NULL REFERENCES public.facilities(id),
 label text NOT NULL, floor integer NOT NULL DEFAULT 1,
 layout jsonb CHECK (layout IS NULL OR (
  jsonb_typeof(layout) = 'object' AND layout ?& ARRAY['x','y','width','height'] AND
  jsonb_typeof(layout->'x') = 'number' AND jsonb_typeof(layout->'y') = 'number' AND
  jsonb_typeof(layout->'width') = 'number' AND jsonb_typeof(layout->'height') = 'number' AND
  (layout->>'width')::numeric > 0 AND (layout->>'height')::numeric > 0)),
 UNIQUE (id, facility_id)
);
CREATE TABLE public.patients (
 id text PRIMARY KEY, facility_id text NOT NULL REFERENCES public.facilities(id),
 display_label text NOT NULL, UNIQUE (id, facility_id)
);
CREATE TABLE public.room_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id text NOT NULL,
 room_id text NOT NULL, patient_id text NOT NULL, assigned_at timestamptz NOT NULL,
 released_at timestamptz CHECK (released_at IS NULL OR released_at > assigned_at),
 FOREIGN KEY (room_id, facility_id) REFERENCES public.rooms(id, facility_id),
 FOREIGN KEY (patient_id, facility_id) REFERENCES public.patients(id, facility_id)
);
CREATE UNIQUE INDEX one_active_patient_per_room ON public.room_assignments(room_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX one_active_room_per_patient ON public.room_assignments(patient_id) WHERE released_at IS NULL;
CREATE TABLE public.devices (
 id text PRIMARY KEY, room_id text NOT NULL REFERENCES public.rooms(id),
 UNIQUE (id, room_id)
);
CREATE TABLE public.inference_events (
 event_id text PRIMARY KEY, device_id text NOT NULL, room_id text NOT NULL,
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 detected_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (device_id, room_id) REFERENCES public.devices(id, room_id),
 UNIQUE (event_id, room_id)
);
CREATE TABLE public.incidents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id text NOT NULL UNIQUE,
 room_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','responding','resolved')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (event_id, room_id) REFERENCES public.inference_events(event_id, room_id)
);
CREATE TABLE public.explanation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid NOT NULL UNIQUE REFERENCES public.incidents(id),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','completed','fallback')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
-- Job claiming and explanation/notification tables arrive with later slices.
REVOKE ALL ON public.facilities, public.facility_memberships, public.rooms, public.patients,
 public.room_assignments, public.devices, public.inference_events, public.incidents,
 public.explanation_jobs FROM anon, authenticated;
GRANT SELECT ON public.facilities, public.facility_memberships, public.rooms, public.patients,
 public.room_assignments, public.incidents TO authenticated;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inference_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explanation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_self ON public.facility_memberships FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY facility_read ON public.facilities FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.facility_memberships m WHERE m.facility_id = facilities.id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY room_read ON public.rooms FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.facility_memberships m WHERE m.facility_id = rooms.facility_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY patient_read ON public.patients FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.facility_memberships m WHERE m.facility_id = patients.facility_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY assignment_read ON public.room_assignments FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.facility_memberships m WHERE m.facility_id = room_assignments.facility_id AND m.user_id = (SELECT auth.uid())));
CREATE POLICY incident_read ON public.incidents FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.rooms r JOIN public.facility_memberships m ON m.facility_id = r.facility_id
  WHERE r.id = incidents.room_id AND m.user_id = (SELECT auth.uid())));
-- Frontend cannot mutate tables or read event payloads/internal jobs directly.
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms, public.incidents;
COMMIT;
