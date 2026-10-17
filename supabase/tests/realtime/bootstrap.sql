-- TEST ONLY: database/Auth role contracts, with real Realtime migrations/replication.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE dashboard_user NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
CREATE ROLE supabase_realtime_admin NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA _realtime;
CREATE SCHEMA realtime;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
  nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE PUBLICATION supabase_realtime;
