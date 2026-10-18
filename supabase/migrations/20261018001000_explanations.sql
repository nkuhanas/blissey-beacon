BEGIN;
ALTER TABLE public.incidents ADD CONSTRAINT incident_id_event_unique UNIQUE(id,event_id);
CREATE TABLE public.explanations (
 incident_id uuid PRIMARY KEY,
 event_id text NOT NULL,
 output jsonb NOT NULL CHECK (
  jsonb_typeof(output)='object' AND output ?& ARRAY['event_id','title','description','recommended_action']
  AND output->>'event_id'=event_id),
 source text NOT NULL CHECK(source IN ('gemini','deterministic')),
 model text NOT NULL, prompt_version text NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,event_id) REFERENCES public.incidents(id,event_id)
);
ALTER TABLE public.explanations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explanations FROM anon,authenticated;
-- Explanation bodies are served through facility-authorized REST. Incident revision
-- updates invalidate existing authorized Realtime subscriptions in the same commit.
ALTER TABLE public.explanation_jobs ADD COLUMN input_facts jsonb;
ALTER TABLE public.explanation_jobs ADD COLUMN input_hash text;
ALTER TABLE public.explanation_jobs ADD COLUMN prompt_version text;
ALTER TABLE public.explanation_jobs ADD COLUMN last_error_code text;
CREATE INDEX explanation_jobs_pending ON public.explanation_jobs(next_attempt_at) WHERE state='pending';
CREATE INDEX explanation_jobs_expired ON public.explanation_jobs(lease_until) WHERE state='processing';
COMMIT;
