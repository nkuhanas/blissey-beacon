BEGIN;
-- Deliberately separate synthetic operator scenarios from hardware identities.
CREATE TABLE public.dashboard_scenarios (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 facility_id text NOT NULL REFERENCES public.facilities(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 idempotency_key text NOT NULL,
 room_id text NOT NULL REFERENCES public.rooms(id),
 scenario text NOT NULL CHECK(scenario IN ('attention','ready','fallback','offline','empty')),
 incident_id uuid REFERENCES public.incidents(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key)
);
ALTER TABLE public.dashboard_scenarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_scenarios FROM anon,authenticated;
COMMIT;
