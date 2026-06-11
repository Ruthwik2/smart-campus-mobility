'use client';

import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import type {
  DriverLocationEvent,
  DriverPresenceEvent,
  Ride,
  RideRequestedEvent,
  RideUnavailableEvent,
  RideUpdateEvent,
} from '@/lib/types';

/**
 * Single source of truth for everything the socket pushes:
 *  - the caller's active ride (both roles)
 *  - the open-request board (drivers)
 *  - the assigned driver's live location (passengers)
 *
 * Socket listeners are bound exactly once per connection via bind();
 * components subscribe to slices and stay dumb.
 */
interface LiveState {
  activeRide: Ride | null;
  lastTerminal: Ride | null; // most recent COMPLETED ride awaiting a rating
  openRequests: Ride[];
  driverLocation: { lat: number; lng: number } | null;
  unavailableNote: string | null;
  setActiveRide: (r: Ride | null) => void;
  setOpenRequests: (r: Ride[]) => void;
  clearTerminal: () => void;
  clearUnavailable: () => void;
  bind: (socket: Socket, selfId: string) => () => void;
}

const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'EXPIRED']);

export const useLive = create<LiveState>((set, get) => ({
  activeRide: null,
  lastTerminal: null,
  openRequests: [],
  driverLocation: null,
  unavailableNote: null,

  setActiveRide: (r) => set({ activeRide: r, driverLocation: null }),
  setOpenRequests: (r) => set({ openRequests: r }),
  clearTerminal: () => set({ lastTerminal: null }),
  clearUnavailable: () => set({ unavailableNote: null }),

  bind: (socket, selfId) => {
    const onRequested = ({ ride }: RideRequestedEvent) => {
      // New job on the board (drivers only receive this).
      set((s) => ({
        openRequests: [ride, ...s.openRequests.filter((r) => r.id !== ride.id)],
      }));
    };

    const onUpdate = ({ ride }: RideUpdateEvent) => {
      const mine = ride.passengerId === selfId || ride.driver?.userId === selfId;
      set((s) => {
        const next: Partial<LiveState> = {
          // A ride that left REQUESTED leaves everyone's board.
          openRequests: s.openRequests.filter((r) => r.id !== ride.id || ride.status === 'REQUESTED'),
        };
        if (ride.status === 'REQUESTED') {
          // Driver bailed → ride is back on the board for everyone.
          next.openRequests = [ride, ...s.openRequests.filter((r) => r.id !== ride.id)];
        }
        if (mine) {
          if (TERMINAL.has(ride.status)) {
            if (s.activeRide?.id === ride.id || !s.activeRide) {
              next.activeRide = null;
              next.driverLocation = null;
            }
            if (ride.status === 'COMPLETED') next.lastTerminal = ride;
          } else {
            next.activeRide = ride;
          }
        }
        return next;
      });
    };

    const onUnavailable = ({ rideId, reason }: RideUnavailableEvent) => {
      set((s) => ({
        openRequests: s.openRequests.filter((r) => r.id !== rideId),
        unavailableNote:
          s.activeRide?.id === rideId || s.openRequests.some((r) => r.id === rideId)
            ? reason === 'TAKEN'
              ? 'Another driver picked that ride up first.'
              : reason === 'EXPIRED'
                ? 'That request expired before anyone accepted.'
                : 'That request was cancelled.'
            : s.unavailableNote,
      }));
    };

    const onLocation = (loc: DriverLocationEvent) => {
      const ride = get().activeRide;
      if (ride && ride.driverId === loc.driverId) {
        set({ driverLocation: { lat: loc.lat, lng: loc.lng } });
      }
    };

    const onPresence = (_p: DriverPresenceEvent) => {
      /* surfaced via nearby-driver refetches; hook kept for future use */
    };

    socket.on('ride:requested', onRequested);
    socket.on('ride:update', onUpdate);
    socket.on('ride:unavailable', onUnavailable);
    socket.on('driver:location', onLocation);
    socket.on('driver:presence', onPresence);

    return () => {
      socket.off('ride:requested', onRequested);
      socket.off('ride:update', onUpdate);
      socket.off('ride:unavailable', onUnavailable);
      socket.off('driver:location', onLocation);
      socket.off('driver:presence', onPresence);
    };
  },
}));
