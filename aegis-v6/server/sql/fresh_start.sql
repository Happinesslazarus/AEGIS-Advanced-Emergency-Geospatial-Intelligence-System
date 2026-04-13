-- AEGIS Fresh Start
-- Wipes operational/user data while preserving schema and core reference tables.
-- Safe against schema drift: dynamically truncates only tables that currently exist.

BEGIN;

DO $$
DECLARE
  table_list TEXT;
BEGIN
  -- Build a schema-aware truncation list from existing public tables.
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
  INTO table_list
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN (
      'schema_migrations',
      'departments',
      'hazard_types',
      'ai_models',
      'spatial_ref_sys'
    );

  IF table_list IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE ' || table_list || ' RESTART IDENTITY CASCADE';
  END IF;
END $$;

COMMIT;
