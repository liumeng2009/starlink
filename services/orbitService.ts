
import { SatelliteInfo, TLEData } from '../types';

const satellite = window.satellite;

export const initializeSatellites = (tles: TLEData[]): SatelliteInfo[] => {
  if (!satellite) return [];
  return tles.map(tle => {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
      return { id: tle.catalogNumber, name: tle.name, tle, satrec };
    } catch (e) {
      return null;
    }
  }).filter(Boolean) as SatelliteInfo[];
};

export const getSatellitePosition = (sat: SatelliteInfo, date: Date) => {
  if (!satellite) return null;
  const positionAndVelocity = satellite.propagate(sat.satrec, date);
  const positionEci = positionAndVelocity.position;
  const velocityEci = positionAndVelocity.velocity;

  if (!positionEci || !velocityEci || typeof positionEci !== 'object') return null;

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  
  // Simple orbital velocity calculation
  const vel = Math.sqrt(velocityEci.x * velocityEci.x + velocityEci.y * velocityEci.y + velocityEci.z * velocityEci.z);
  const geodetic = satellite.eciToGeodetic(positionEci, gmst);

  return {
    x: positionEcf.x * 1000,
    y: positionEcf.y * 1000,
    z: positionEcf.z * 1000,
    velocity: vel,
    height: geodetic.height,
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude)
  };
};

export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];

  // Use a fixed GMST for the entire orbit path calculation to keep the orbit ring 
  // stable in the current Earth reference frame (prevents gaps/jitter)
  const gmst = satellite.gstime(startTime);
  const meanMotionRadMin = sat.satrec.no; 
  const periodMinutes = (2 * Math.PI) / meanMotionRadMin;

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  const segments = 90; // Balanced quality/speed
  
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const offsetMs = fraction * periodMinutes * 60 * 1000;
    const futureDate = new Date(startMs + offsetMs);
    
    const pv = satellite.propagate(sat.satrec, futureDate);
    const posEci = pv.position;

    if (posEci && typeof posEci === 'object') {
      const posEcf = satellite.eciToEcf(posEci, gmst);
      positions.push({
        x: posEcf.x * 1000,
        y: posEcf.y * 1000,
        z: posEcf.z * 1000
      });
    }
  }

  // Force close the orbital loop for clean visualization
  if (positions.length > 0) {
    positions[positions.length - 1] = { ...positions[0] };
  }

  return positions;
};
