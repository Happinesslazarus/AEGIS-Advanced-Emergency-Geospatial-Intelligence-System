-- Migration: Error Resilience & System Health Tables
-- Creates tables for frontend errors, backend errors, external API errors,
-- n8n workflow errors, and a response/data cache table.

-- Frontend errors (from React error boundaries)
CREATE TABLE IF NOT EXISTS frontend_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  error_message text NOT NULL,
  error_stack text,
  component_name text,
  route text,
  user_id text,
  user_role text,
  browser_info text,
  extra jsonb,
  created_at timestamptz DEFAULT now()
);

-- Backend API errors
CREATE TABLE IF NOT EXISTS system_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint text NOT NULL,
  error_type text NOT NULL,
  error_message text NOT NULL,
  stack_trace text,
  request_payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- External API failures (SEPA, Met Office, OpenWeatherMap, HuggingFace, LLM providers)
CREATE TABLE IF NOT EXISTS external_api_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name text NOT NULL,
  endpoint_url text,
  attempt_number integer DEFAULT 1,
  error_message text,
  response_status integer,
  fallback_used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- n8n workflow errors (written by n8n error handlers or fallback cron)
CREATE TABLE IF NOT EXISTS n8n_workflow_errors (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_name text NOT NULL,
  workflow_id text,
  error_message text NOT NULL,
  execution_data jsonb,
  retried boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Data cache for external API responses (used by callExternalAPI wrapper)
CREATE TABLE IF NOT EXISTS api_response_cache (
  cache_key text PRIMARY KEY,
  data jsonb NOT NULL,
  source text DEFAULT 'live',
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '1 hour')
);

-- Index for cleanup jobs
CREATE INDEX IF NOT EXISTS idx_frontend_errors_created ON frontend_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_errors_created ON system_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_api_errors_created ON external_api_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_n8n_errors_created ON n8n_workflow_errors(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_response_cache(expires_at);
