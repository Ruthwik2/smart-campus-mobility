/** Haversine distance in km between two WGS84 points. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Campus tariff: flag-down 20 INR + 10 INR/km, rounded to the nearest rupee. */
export function estimateFare(distanceKm: number): number {
  const BASE = 20;
  const PER_KM = 10;
  return Math.max(BASE, Math.round(BASE + distanceKm * PER_KM));
}
