export type Role = 'PASSENGER' | 'DRIVER' | 'ADMIN';
export type DriverStatus = 'OFFLINE' | 'ONLINE' | 'BUSY';
export type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type VehicleType = 'E_RICKSHAW' | 'AUTO' | 'CAB' | 'SHUTTLE';
export type RideStatus =
  | 'SCHEDULED'
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';
export type PaymentMethod = 'CASH' | 'UPI';
export type PaymentStatus = 'PENDING' | 'PAID';

export interface DriverProfile {
  id: string;
  userId: string;
  licenseNumber: string;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  capacity: number;
  verificationStatus: VerificationStatus;
  verificationNote?: string | null;
  status: DriverStatus;
  currentLat?: number | null;
  currentLng?: number | null;
  ratingAvg: number;
  ratingCount: number;
  totalRides: number;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role: Role;
  avatarUrl?: string | null;
  driverProfile?: DriverProfile | null;
  createdAt: string;
}

export interface Rating {
  id: string;
  rideId: string;
  stars: number;
  comment?: string | null;
  createdAt: string;
}

/** `driver` on a ride is the DriverProfile (with nested user), mirroring rideInclude. */
export interface RideDriver {
  id: string;
  userId: string;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  ratingAvg: number;
  ratingCount: number;
  currentLat?: number | null;
  currentLng?: number | null;
  user: { fullName: string; phone?: string | null; avatarUrl?: string | null };
}

export interface Ride {
  id: string;
  code: string;
  status: RideStatus;
  passengerId: string;
  driverId?: string | null; // DriverProfile id
  passenger?: { id: string; fullName: string; phone?: string | null; avatarUrl?: string | null };
  driver?: RideDriver | null;
  pickupLabel: string;
  pickupLat: number;
  pickupLng: number;
  dropLabel: string;
  dropLat: number;
  dropLng: number;
  distanceKm?: number | null;
  estimatedFare?: number | null;
  finalFare?: number | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  paymentRef?: string | null;
  startOtp?: string | null;
  scheduledFor?: string | null;
  requestedAt?: string | null;
  acceptedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  rating?: Rating | null;
  createdAt: string;
}

export interface CampusZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface NearbyDriver {
  id: string;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  capacity: number;
  ratingAvg: number;
  ratingCount: number;
  currentLat?: number | null;
  currentLng?: number | null;
  user: { fullName: string; avatarUrl?: string | null };
}

export interface DriverDashboard {
  profile: DriverProfile;
  stats: {
    totalRides: number;
    totalEarnings: number;
    totalDistanceKm: number;
    todayRides: number;
    todayEarnings: number;
    ratingAvg: number;
    ratingCount: number;
  };
  daily: { day: string; rides: number; earnings: number }[];
  ratingBreakdown: { stars: number; count: number }[];
  recentRides: Ride[];
}

// ---- socket payloads ----------------------------------------------------------
export interface RideRequestedEvent {
  ride: Ride;
}
export interface RideUpdateEvent {
  ride: Ride;
  previousStatus?: RideStatus;
}
export interface RideUnavailableEvent {
  rideId: string;
  reason: 'TAKEN' | 'CANCELLED' | 'EXPIRED';
}
export interface DriverPresenceEvent {
  driverId: string;
  status: DriverStatus;
}
export interface DriverLocationEvent {
  driverId: string; // DriverProfile id
  lat: number;
  lng: number;
  rideId?: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
