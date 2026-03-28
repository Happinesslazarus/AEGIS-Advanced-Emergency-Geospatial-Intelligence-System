-- AEGIS v6 — Row-Level Security Migration
-- PostgreSQL 14+ with PostGIS
-- Defence-in-depth: the app currently connects as postgres (superuser,
-- bypasses RLS), but these policies prepare for the switch to a
-- restricted `aegis_app` role.
-- Date: 2026-03-24

-- §0  Application role (idempotent)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aegis_app') THEN
    CREATE ROLE aegis_app LOGIN;
  END IF;
END $$;

-- Grant baseline permissions so aegis_app can operate on public schema
GRANT USAGE ON SCHEMA public TO aegis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aegis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aegis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aegis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO aegis_app;

-- §1  Enable RLS on critical tables

ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE operators     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE citizens      ENABLE ROW LEVEL SECURITY;

-- §2  RLS Policies
-- Every policy is wrapped in a DO block so the migration is re-runnable
-- (DROP IF EXISTS + CREATE).

-- reports

DO $$ BEGIN
  DROP POLICY IF EXISTS reports_select_policy ON reports;
  CREATE POLICY reports_select_policy ON reports
    FOR SELECT TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS reports_insert_policy ON reports;
  CREATE POLICY reports_insert_policy ON reports
    FOR INSERT TO aegis_app
    WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS reports_update_policy ON reports;
  CREATE POLICY reports_update_policy ON reports
    FOR UPDATE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS reports_delete_policy ON reports;
  CREATE POLICY reports_delete_policy ON reports
    FOR DELETE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

-- operators

DO $$ BEGIN
  DROP POLICY IF EXISTS operators_select_policy ON operators;
  CREATE POLICY operators_select_policy ON operators
    FOR SELECT TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS operators_insert_policy ON operators;
  CREATE POLICY operators_insert_policy ON operators
    FOR INSERT TO aegis_app
    WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS operators_update_policy ON operators;
  CREATE POLICY operators_update_policy ON operators
    FOR UPDATE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS operators_delete_policy ON operators;
  CREATE POLICY operators_delete_policy ON operators
    FOR DELETE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

-- citizens

DO $$ BEGIN
  DROP POLICY IF EXISTS citizens_select_policy ON citizens;
  CREATE POLICY citizens_select_policy ON citizens
    FOR SELECT TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS citizens_insert_policy ON citizens;
  CREATE POLICY citizens_insert_policy ON citizens
    FOR INSERT TO aegis_app
    WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS citizens_update_policy ON citizens;
  CREATE POLICY citizens_update_policy ON citizens
    FOR UPDATE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS citizens_delete_policy ON citizens;
  CREATE POLICY citizens_delete_policy ON citizens
    FOR DELETE TO aegis_app
    USING (deleted_at IS NULL);
END $$;

-- user_sessions
-- Sessions use current_setting('app.current_user_id') for row-scoping.
-- The application must SET LOCAL app.current_user_id = '<uuid>' per
-- transaction once it switches to the aegis_app role.

DO $$ BEGIN
  DROP POLICY IF EXISTS sessions_select_policy ON user_sessions;
  CREATE POLICY sessions_select_policy ON user_sessions
    FOR SELECT TO aegis_app
    USING (
      user_id::text = current_setting('app.current_user_id', true)
      OR current_setting('app.current_role', true) = 'admin'
    );
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS sessions_insert_policy ON user_sessions;
  CREATE POLICY sessions_insert_policy ON user_sessions
    FOR INSERT TO aegis_app
    WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS sessions_update_policy ON user_sessions;
  CREATE POLICY sessions_update_policy ON user_sessions
    FOR UPDATE TO aegis_app
    USING (
      user_id::text = current_setting('app.current_user_id', true)
      OR current_setting('app.current_role', true) = 'admin'
    );
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS sessions_delete_policy ON user_sessions;
  CREATE POLICY sessions_delete_policy ON user_sessions
    FOR DELETE TO aegis_app
    USING (
      user_id::text = current_setting('app.current_user_id', true)
      OR current_setting('app.current_role', true) = 'admin'
    );
END $$;

-- §3  Verification
-- Quick sanity check: list all RLS-enabled tables and their policies.

DO $$
DECLARE
  _tbl TEXT;
BEGIN
  FOR _tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('reports','operators','user_sessions','citizens')
  LOOP
    RAISE NOTICE 'RLS enabled on: %', _tbl;
  END LOOP;
END $$;
