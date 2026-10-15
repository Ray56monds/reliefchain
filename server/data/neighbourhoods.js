// Kampala neighbourhoods served by ReliefChain. Risk levels mirror KampalAlert's
// flood-risk zoning: Bwaise, Kinawataka and Nakivubo sit in the Nakivubo /
// Lubigi channel flood plains and flood almost every rainy season.
export const NEIGHBOURHOODS = [
  { name: 'Bwaise', lat: 0.3538, lon: 32.559, risk: 'HIGH' },
  { name: 'Kinawataka', lat: 0.3275, lon: 32.6201, risk: 'HIGH' },
  { name: 'Nakivubo', lat: 0.3103, lon: 32.5867, risk: 'HIGH' },
  { name: 'Makindye', lat: 0.2946, lon: 32.5825, risk: 'MEDIUM' },
  { name: 'Kawempe', lat: 0.3728, lon: 32.5619, risk: 'MEDIUM' },
  { name: 'Rubaga', lat: 0.3047, lon: 32.5522, risk: 'MEDIUM' },
];

export const findNeighbourhood = (name) =>
  NEIGHBOURHOODS.find((n) => n.name.toLowerCase() === String(name || '').toLowerCase());

export const VULNERABLE_GROUPS = ['elderly', 'children', 'disabled', 'pregnant', 'chronically_ill'];
