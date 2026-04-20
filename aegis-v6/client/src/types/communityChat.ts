/**
  * TypeScript interfaces for the community chat feature: OnlineUser,
  * CommunityMessage, ChatRoom, and related socket event payloads.
  * Shared between components and contexts that handle community chat.
  *
  * - Used by FloatingChatWidget.tsx and communityRoutes-related hooks
  * - Socket event payloads should match server/src/services/socket.ts types
  * - Extends the general Message type from types/index.ts
 */

/** Online user structure */
export interface OnlineUser {
  userId: string
  displayName: string
  role: string
}

/** Response for socket acknowledgment callbacks */
export interface SocketAck {
  success: boolean
  error?: string
}

/** Join room acknowledgment */
export interface JoinAck extends SocketAck {
  users?: OnlineUser[]
  banned?: boolean
  reason?: string
}

/** Online users response */
export interface OnlineAck extends SocketAck {
  users: OnlineUser[]
}

/** History response */
export interface HistoryAck extends SocketAck {
  messages: ChatMessage[]
}

/** Message send acknowledgment */
export interface MessageSendAck extends SocketAck {
  messageId?: string
  tempId?: string
  message?: ChatMessage
  muted?: boolean
  expires_at?: string
}

/** Delete acknowledgment */
export interface DeleteAck extends SocketAck {
  deleted?: boolean
}

/** Edit acknowledgment */
export interface EditAck extends SocketAck {
  edited?: boolean
}

/** Report acknowledgment */
export interface ReportAck extends SocketAck {
  reportId?: string
}

/** Ban/Mute acknowledgment */
export interface ModerationAck extends SocketAck {
  action?: 'ban' | 'mute'
  userId?: string
}

/** Read receipt user */
export interface ReadByUser {
  user_id: string
  user_type: string
  read_at: string
}

/** Chat message structure */
export interface ChatMessage {
  id: string
  sender_id: string
  sender_type: 'citizen' | 'operator'
  sender_name: string
  sender_role?: string | null
  sender_avatar?: string
  content: string
  image_url?: string | null
  reply_to_id?: string | null
  reply_content?: string | null
  reply_sender_name?: string | null
  created_at: string
  deleted_at?: string | null
  edited_at?: string | null
  read_by?: ReadByUser[]
  deleted_by?: string | null
  deleted_by_name?: string | null
  delete_reason?: string | null
}

/** Delete payload */
export interface DeletePayload {
  messageId: string
  reason?: string
  hardDelete?: boolean
}

/** Ban payload */
export interface BanPayload {
  userId: string
  reason: string
  duration: string
}

/** Report payload */
export interface ReportPayload {
  messageId: string
  reason: string
  description?: string
}

/** Edit payload */
export interface EditPayload {
  messageId: string
  newContent: string
}

/** Typing user info */
export interface TypingUser {
  userId: string
  displayName: string
}

/** Messages read event data */
export interface MessagesReadData {
  messages: Array<{
    id: string
    read_by: ReadByUser[]
  }>
}

/** Admin user data from operators context */
export interface AdminUserData {
  id: string
  display_name: string
  displayName?: string
  email: string
  role: string
  avatar_url?: string
}

/** Type guard for checking if read_by contains other users */
export function hasOtherReaders(readBy: ReadByUser[] | undefined, userId: string): boolean {
  if (!readBy || !Array.isArray(readBy)) return false
  return readBy.some((r) => r.user_id !== userId)
}
