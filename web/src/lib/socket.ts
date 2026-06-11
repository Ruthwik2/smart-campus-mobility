import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from './api';

/**
 * One socket per tab, created after login and torn down on logout.
 * The JWT rides in the handshake (`auth.token`); on token rotation we
 * refresh `auth` and force a reconnect so the server re-validates.
 */
let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket?.connected) return socket;
  if (socket) {
    socket.auth = { token: getAccessToken() };
    socket.connect();
    return socket;
  }
  socket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: getAccessToken() },
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
