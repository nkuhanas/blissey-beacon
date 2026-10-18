-- Fictional records only. Provision operator accounts through Supabase Auth,
-- then explicitly add facility_memberships. Never seed shared credentials here.
INSERT INTO public.facilities(id,label) VALUES ('demo_facility','James West Alumni Center at UCLA') ON CONFLICT DO NOTHING;
INSERT INTO public.rooms(id,facility_id,label,floor,layout) VALUES
 ('room_102','demo_facility','Room 102',1,'{"x":200,"y":150,"width":120,"height":100}') ON CONFLICT DO NOTHING;
INSERT INTO public.patients(id,facility_id,display_label) VALUES ('demo_resident_102','demo_facility','Demo Resident 102') ON CONFLICT DO NOTHING;
INSERT INTO public.room_assignments(facility_id,room_id,patient_id,assigned_at)
 SELECT 'demo_facility','room_102','demo_resident_102','2026-10-17T00:00:00Z'
 WHERE NOT EXISTS (SELECT 1 FROM public.room_assignments WHERE room_id='room_102' AND released_at IS NULL);
INSERT INTO public.devices(id,room_id) VALUES ('pi_102','room_102') ON CONFLICT DO NOTHING;
