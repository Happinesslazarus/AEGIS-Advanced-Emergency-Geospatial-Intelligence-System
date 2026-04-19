/**
 * Community event broadcaster — minimal Socket.IO wrapper that emits
 * events to all clients in the 'community' room.
 *
 * - Stores a reference to the Socket.IO server instance
 * - Called by community routes to broadcast updates
 * */

import type { Server } from 'socket.io'

let ioRef: Server | null = null

export function setCommunityRealtimeIo(io: Server): void {
  ioRef = io
}

export function emitCommunityEvent(event: string, payload: unknown): void {
  if (!ioRef) return
  ioRef.to('community').emit(event, payload)
}
