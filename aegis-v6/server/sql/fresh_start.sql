-- AEGIS Fresh Start: Wipe all user data, reports, messages, chat, AI logs
-- Keeps: schema, departments, hazard_types/ai_models definitions
BEGIN;

-- Disable FK constraints temporarily
SET session_replication_role = 'replica';

-- Chat & messaging
TRUNCATE TABLE chat_messages CASCADE;
TRUNCATE TABLE chat_sessions CASCADE;
TRUNCATE TABLE message_threads CASCADE;
TRUNCATE TABLE messages CASCADE;
TRUNCATE TABLE citizen_chat_memory CASCADE;
TRUNCATE TABLE conversation_summaries CASCADE;
TRUNCATE TABLE chat_suggestion_clicks CASCADE;
TRUNCATE TABLE canned_replies CASCADE;
TRUNCATE TABLE response_cache CASCADE;

-- Citizens & profiles
TRUNCATE TABLE citizens CASCADE;
TRUNCATE TABLE citizen_preferences CASCADE;
TRUNCATE TABLE citizen_behavior_profile CASCADE;
TRUNCATE TABLE operator_behavior_profile CASCADE;
TRUNCATE TABLE emergency_contacts CASCADE;
TRUNCATE TABLE safety_check_ins CASCADE;
TRUNCATE TABLE consent_records CASCADE;

-- Community
TRUNCATE TABLE community_posts CASCADE;
TRUNCATE TABLE community_comments CASCADE;
TRUNCATE TABLE community_post_likes CASCADE;
TRUNCATE TABLE community_post_shares CASCADE;
TRUNCATE TABLE community_post_reports CASCADE;
TRUNCATE TABLE community_reports CASCADE;
TRUNCATE TABLE community_members CASCADE;
TRUNCATE TABLE community_bans CASCADE;
TRUNCATE TABLE community_mutes CASCADE;
TRUNCATE TABLE community_chat_messages CASCADE;
TRUNCATE TABLE community_moderation_logs CASCADE;
TRUNCATE TABLE community_help CASCADE;

-- Reports & alerts
TRUNCATE TABLE reports CASCADE;
TRUNCATE TABLE report_media CASCADE;
TRUNCATE TABLE report_status_history CASCADE;
TRUNCATE TABLE alerts CASCADE;
TRUNCATE TABLE alert_subscriptions CASCADE;
TRUNCATE TABLE alert_delivery_log CASCADE;
TRUNCATE TABLE citizen_alert_history CASCADE;
TRUNCATE TABLE external_alerts CASCADE;

-- AI & predictions
TRUNCATE TABLE ai_executions CASCADE;
TRUNCATE TABLE ai_predictions CASCADE;
TRUNCATE TABLE prediction_records CASCADE;
TRUNCATE TABLE prediction_logs CASCADE;
TRUNCATE TABLE flood_predictions CASCADE;
TRUNCATE TABLE model_drift_metrics CASCADE;
TRUNCATE TABLE training_jobs CASCADE;
TRUNCATE TABLE model_monitoring_snapshots CASCADE;
TRUNCATE TABLE model_performance_history CASCADE;
TRUNCATE TABLE token_usage_log CASCADE;
TRUNCATE TABLE ai_model_metrics CASCADE;

-- Auth & sessions
TRUNCATE TABLE user_sessions CASCADE;
TRUNCATE TABLE security_events CASCADE;
TRUNCATE TABLE trusted_devices CASCADE;
TRUNCATE TABLE password_reset_tokens CASCADE;
TRUNCATE TABLE password_history CASCADE;
TRUNCATE TABLE two_factor_temp_tokens CASCADE;
TRUNCATE TABLE push_subscriptions CASCADE;

-- Operators (wipe all, keep departments)
TRUNCATE TABLE operators CASCADE;

-- Logs & monitoring
TRUNCATE TABLE activity_log CASCADE;
TRUNCATE TABLE audit_log CASCADE;
TRUNCATE TABLE system_events CASCADE;
TRUNCATE TABLE frontend_errors CASCADE;
TRUNCATE TABLE system_errors CASCADE;
TRUNCATE TABLE external_api_errors CASCADE;
TRUNCATE TABLE n8n_workflow_errors CASCADE;

-- Resources & infrastructure
TRUNCATE TABLE resource_deployments CASCADE;
TRUNCATE TABLE damage_estimates CASCADE;
TRUNCATE TABLE distress_calls CASCADE;
TRUNCATE TABLE distress_location_history CASCADE;
TRUNCATE TABLE threat_level_log CASCADE;
TRUNCATE TABLE river_levels CASCADE;
TRUNCATE TABLE user_presence CASCADE;
TRUNCATE TABLE account_deletion_log CASCADE;
TRUNCATE TABLE translations_cache CASCADE;
TRUNCATE TABLE api_response_cache CASCADE;
TRUNCATE TABLE rag_documents CASCADE;

-- Re-enable FK constraints
SET session_replication_role = 'origin';

COMMIT;
