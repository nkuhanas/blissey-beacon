BEGIN;
-- Existing approvals retain their original manual-review semantics and hashes.
ALTER TABLE public.message_previews ADD COLUMN followup_policy text NOT NULL DEFAULT 'manual-v1'
 CHECK(followup_policy IN ('manual-v1','automatic-v2'));
CREATE TABLE public.call_recovery (
 call_id uuid PRIMARY KEY REFERENCES public.notification_calls(id),
 lease_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_recovery FROM anon,authenticated;
COMMIT;
