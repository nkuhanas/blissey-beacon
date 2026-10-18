BEGIN;
ALTER TABLE public.incidents ADD COLUMN disposition text CHECK(disposition IN ('reported_fall','false_alarm','unknown'));
ALTER TABLE public.incidents ADD CONSTRAINT incident_facility_unique UNIQUE(id,facility_id);
CREATE TABLE public.operator_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id text NOT NULL REFERENCES public.facilities(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), action text NOT NULL, target_id text NOT NULL,
 request_key text, request_hash text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,request_key)
);
CREATE TABLE public.family_contacts (
 id uuid PRIMARY KEY, facility_id text NOT NULL, patient_id text NOT NULL,
 contact_name text NOT NULL CHECK(length(contact_name) BETWEEN 1 AND 80),
 relationship text NOT NULL CHECK(length(relationship) BETWEEN 1 AND 80),
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 consent_status text NOT NULL CHECK(consent_status IN ('granted','revoked')),
 consented_at timestamptz, consent_revoked_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(patient_id,facility_id) REFERENCES public.patients(id,facility_id),
 UNIQUE(patient_id), UNIQUE(id,facility_id),
 CHECK(consent_status<>'granted' OR consented_at IS NOT NULL)
);
CREATE TABLE public.call_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES auth.users(id),
 incident_id uuid NOT NULL, facility_id text NOT NULL, contact_id uuid NOT NULL,
 incident_revision integer NOT NULL, contact_revision integer NOT NULL,
 patient_id text NOT NULL, context jsonb NOT NULL, opening text NOT NULL,
 policy_version text NOT NULL, context_hash text NOT NULL CHECK(context_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id)
);
CREATE TABLE public.notification_calls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid NOT NULL, facility_id text NOT NULL,
 contact_id uuid NOT NULL, preview_id uuid NOT NULL UNIQUE REFERENCES public.call_previews(id),
 approved_by uuid NOT NULL REFERENCES auth.users(id), idempotency_key text NOT NULL, request_hash text NOT NULL,
 contact_revision integer NOT NULL, context jsonb NOT NULL, opening text NOT NULL, policy_version text NOT NULL,
 context_hash text NOT NULL, destination text NOT NULL,
 retry_of uuid UNIQUE REFERENCES public.notification_calls(id),
 transport_status text NOT NULL DEFAULT 'queued' CHECK(transport_status IN ('queued','initiating','in_progress','completed','failed','unknown')),
 connected boolean NOT NULL DEFAULT false, notification_spoken boolean NOT NULL DEFAULT false,
 callback_requested boolean NOT NULL DEFAULT false, summary text CHECK(length(summary)<=400),
 error_code text, provider_conversation_id text UNIQUE, provider_sip_call_id text UNIQUE,
 attempt_id uuid UNIQUE, submitted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id),
 UNIQUE(approved_by,idempotency_key)
);
CREATE UNIQUE INDEX one_initial_family_call ON public.notification_calls(incident_id,contact_id) WHERE retry_of IS NULL;
CREATE INDEX queued_calls ON public.notification_calls(created_at) WHERE transport_status='queued';
CREATE TABLE public.notification_attempts (
 id uuid PRIMARY KEY, call_id uuid NOT NULL UNIQUE REFERENCES public.notification_calls(id),
 state text NOT NULL CHECK(state IN ('initiating','accepted','failed','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notification_provider_events (
 event_hash text PRIMARY KEY, conversation_id text, call_id uuid REFERENCES public.notification_calls(id),
 kind text NOT NULL, normalized jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now()
);
-- No private contacts, approved contexts, attempt records or provider bodies are browser-readable.
ALTER TABLE public.operator_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_audit,public.family_contacts,public.call_previews,public.notification_calls,
 public.notification_attempts,public.notification_provider_events FROM anon,authenticated;
COMMIT;
