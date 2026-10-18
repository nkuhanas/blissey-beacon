BEGIN;
ALTER TABLE public.message_previews DROP CONSTRAINT message_previews_followup_policy_check;
ALTER TABLE public.message_previews ADD CONSTRAINT message_previews_followup_policy_check CHECK(followup_policy IN ('manual-v1','automatic-v2','automatic-v3'));
COMMIT;
