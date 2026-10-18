BEGIN;
ALTER TABLE public.inference_events ADD COLUMN archived_at timestamptz;
ALTER TABLE public.incidents ADD COLUMN archived_at timestamptz;
ALTER TABLE public.incidents ADD COLUMN resolved_at timestamptz;
UPDATE public.incidents i SET resolved_at=COALESCE((SELECT max(a.created_at) FROM public.operator_audit a WHERE a.target_id=i.id::text AND a.action='incident_action' AND a.detail->>'status'='resolved'),i.created_at) WHERE i.status='resolved';
CREATE FUNCTION public.stamp_resolution() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status='resolved' AND OLD.status<>'resolved' THEN NEW.resolved_at=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stamp_resolution BEFORE UPDATE OF status ON public.incidents FOR EACH ROW EXECUTE FUNCTION public.stamp_resolution();
CREATE TABLE public.demo_room_streams (
 room_id text PRIMARY KEY REFERENCES public.rooms(id),
 mode text NOT NULL DEFAULT 'healthy' CHECK(mode IN ('healthy','offline')),
 sample_index integer NOT NULL DEFAULT 0,
 sampled_at timestamptz,
 confidence_scores jsonb NOT NULL DEFAULT '{"fall":0.02,"non_fall":0.98}',
 source text NOT NULL DEFAULT 'synthetic' CHECK(source='synthetic'),
 CHECK(room_id<>'101')
);
ALTER TABLE public.demo_room_streams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.demo_room_streams FROM anon,authenticated;
-- Archived incidents stay durable but are absent from direct normal client reads, too.
ALTER POLICY incident_read ON public.incidents USING (archived_at IS NULL AND EXISTS (
 SELECT 1 FROM public.rooms r JOIN public.facility_memberships m ON m.facility_id=r.facility_id
 WHERE r.id=incidents.room_id AND m.user_id=(SELECT auth.uid())));
UPDATE public.facilities SET label='James West Alumni Center at UCLA' WHERE id='demo_facility';
COMMIT;
