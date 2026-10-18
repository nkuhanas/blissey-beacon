BEGIN;
ALTER TABLE public.family_contacts ADD COLUMN imessage_consent_status text NOT NULL DEFAULT 'revoked' CHECK(imessage_consent_status IN ('granted','revoked'));
ALTER TABLE public.family_contacts ADD COLUMN imessage_consented_at timestamptz;
ALTER TABLE public.family_contacts ADD COLUMN imessage_consent_revoked_at timestamptz;
CREATE TABLE public.message_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES auth.users(id),
 incident_id uuid NOT NULL, facility_id text NOT NULL, contact_id uuid NOT NULL,
 incident_revision integer NOT NULL, contact_revision integer NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('followup','update')),
 candidates jsonb NOT NULL, route jsonb NOT NULL, context_hash text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id)
);
CREATE TABLE public.message_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preview_id uuid NOT NULL UNIQUE REFERENCES public.message_previews(id),
 incident_id uuid NOT NULL, facility_id text NOT NULL, contact_id uuid NOT NULL,
 call_id uuid UNIQUE REFERENCES public.notification_calls(id), approved_by uuid NOT NULL REFERENCES auth.users(id),
 request_key text NOT NULL, request_hash text NOT NULL, contact_revision integer NOT NULL,
 candidates jsonb NOT NULL, route jsonb NOT NULL, context_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('waiting','review','queued','cancelled','submitted')),
 selection text CHECK(selection IN ('missed','summary','update')), evidence text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(approved_by,request_key), UNIQUE(id,facility_id),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id)
);
CREATE TABLE public.notification_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), authorization_id uuid NOT NULL UNIQUE REFERENCES public.message_authorizations(id),
 incident_id uuid NOT NULL, facility_id text NOT NULL, contact_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 1600), route jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','initiating','accepted','delivered','read','failed','unknown','cancelled')),
 provider_message_id text UNIQUE, error_code text, submitted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id)
);
CREATE TABLE public.message_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), message_id uuid NOT NULL UNIQUE REFERENCES public.notification_messages(id),
 state text NOT NULL CHECK(state IN ('initiating','accepted','failed','unknown')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.family_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_message_id text NOT NULL UNIQUE,
 facility_id text NOT NULL REFERENCES public.facilities(id), contact_id uuid NOT NULL,
 incident_id uuid, space_id text NOT NULL, sender_id text NOT NULL, recipient_id text NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 intent text NOT NULL CHECK(intent IN ('acknowledged','callback_requested','stop','operator_review')),
 review_status text NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','reviewed')),
 received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(incident_id,facility_id) REFERENCES public.incidents(id,facility_id),
 FOREIGN KEY(contact_id,facility_id) REFERENCES public.family_contacts(id,facility_id)
);
CREATE TABLE public.message_poll_state (
 route_key text PRIMARY KEY, route jsonb NOT NULL, since_at timestamptz NOT NULL,
 page_token text, lease_until timestamptz, lease_id uuid
);
CREATE INDEX message_work ON public.notification_messages(created_at) WHERE state='queued';
CREATE INDEX reply_inbox ON public.family_replies(facility_id,created_at);
ALTER TABLE public.message_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_poll_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_previews,public.message_authorizations,public.notification_messages,public.message_attempts,public.family_replies,public.message_poll_state FROM anon,authenticated;
COMMIT;
