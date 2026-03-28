-- migration_chat_tables.sql
-- Moves runtime DDL from socket.ts into a proper migration.
-- These tables were previously created at server startup via initDb() in socket.ts.

-- Message threads (citizen-operator direct messaging)
CREATE TABLE IF NOT EXISTS message_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL,
  subject VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  assigned_to UUID,
  is_emergency BOOLEAN NOT NULL DEFAULT false,
  auto_escalated BOOLEAN NOT NULL DEFAULT false,
  escalation_keywords TEXT[],
  last_message_at TIMESTAMPTZ,
  citizen_unread INTEGER NOT NULL DEFAULT 0,
  operator_unread INTEGER NOT NULL DEFAULT 0,
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Direct messages within threads
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL,
  sender_id UUID NOT NULL,
  content TEXT,
  attachment_url TEXT,
  attachment_type VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  operator_id UUID,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Community chat messages
CREATE TABLE IF NOT EXISTS community_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  sender_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
  content TEXT,
  image_url TEXT,
  reply_to_id UUID,
  read_by JSONB DEFAULT '[]'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User presence tracking
CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY,
  user_type VARCHAR(20) NOT NULL DEFAULT 'citizen',
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  socket_id VARCHAR(50)
);

-- Community posts
CREATE TABLE IF NOT EXISTS community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  image_url VARCHAR(500),
  location VARCHAR(255),
  is_hazard_update BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Community comments
CREATE TABLE IF NOT EXISTS community_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  image_url VARCHAR(500),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Community post likes
CREATE TABLE IF NOT EXISTS community_post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, user_id)
);

-- Community post shares
CREATE TABLE IF NOT EXISTS community_post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
