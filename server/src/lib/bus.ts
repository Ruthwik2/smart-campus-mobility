import { EventEmitter } from 'node:events';

/**
 * In-process domain event bus.
 *
 * Services publish domain events; the socket gateway and queue layer
 * subscribe. This keeps business logic free of any Socket.IO/BullMQ
 * imports (no circular deps) and gives a single seam to swap in a
 * message broker if the platform ever outgrows one node.
 */
export type RidePayload = Record<string, unknown> & {
  id: string;
  passengerId: string;
  driverId?: string | null;
  status: string;
};

export type DomainEvents = {
  'ride.requested': { ride: RidePayload };
  'ride.updated': { ride: RidePayload; previousStatus?: string };
  'ride.unavailable': { rideId: string; reason: 'TAKEN' | 'CANCELLED' | 'EXPIRED' };
  'driver.presence': { driverId: string; userId: string; status: string };
  'driver.location': { driverId: string; lat: number; lng: number; rideId?: string | null };
};

class TypedBus extends EventEmitter {
  publish<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) {
    this.emit(event, payload);
  }
  subscribe<K extends keyof DomainEvents>(event: K, handler: (p: DomainEvents[K]) => void) {
    this.on(event, handler);
  }
}

export const bus = new TypedBus();
