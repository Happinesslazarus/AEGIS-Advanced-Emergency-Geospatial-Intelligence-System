import type { Server } from 'socket.io'

let ioRef: Server | null = null

export function setCommunityRealtimeIo(io: Server): void {
  ioRef = io
}

export function emitCommunityEvent(event: string, payload: unknown): void {
  if (!ioRef) return
  ioRef.to('community').emit(event, payload)
}
