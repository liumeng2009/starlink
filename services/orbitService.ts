import { SatelliteInfo, TLEData } from '../types';

// Access global satellite object loaded via CDN
const satellite = window.satellite;

export const initializeSatellites = (tles: TLEData[]): SatelliteInfo[] => {
  if (!satellite) {
    console.error("Satellite.js not loaded");
    return [];
  }

  return tles.map(tle => {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
      return {
        id: tle.catalogNumber,
        name: tle.name,
        tle,
        satrec
      };
    } catch (e) {
      console.warn(`Failed to parse satellite ${tle.name}`, e);
      return null;
    }
  }).filter(Boolean) as SatelliteInfo[];
};

export const getSatellitePosition = (sat: SatelliteInfo, date: Date) => {
  if (!satellite) return null;

  // 1. Propagate to find position and velocity
  const positionAndVelocity = satellite.propagate(sat.satrec, date);
  const positionEci = positionAndVelocity.position;
  const velocityEci = positionAndVelocity.velocity;

  if (!positionEci || !velocityEci) return null;

  // 2. Convert ECI (Earth-Centered Inertial) to ECF (Earth-Centered Fixed) for Cesium
  const gmst = satellite.gstime(date);
  
  // satellite.js types can be tricky, cast as needed or assume structure
  const positionEcf = satellite.eciToEcf(positionEci, gmst);

  // 3. Calculate Height/Velocity for UI
  // Velocity vector magnitude
  const vel = Math.sqrt(
    Math.pow(velocityEci.x, 2) + 
    Math.pow(velocityEci.y, 2) + 
    Math.pow(velocityEci.z, 2)
  );

  // Geodetic info (lat, lon, height)
  const geodetic = satellite.eciToGeodetic(positionEci, gmst);
  const heightKm = geodetic.height;

  // 4. Return formatted data. Note: satellite.js returns km, Cesium needs meters.
  return {
    x: positionEcf.x * 1000,
    y: positionEcf.y * 1000,
    z: positionEcf.z * 1000,
    velocity: vel,
    height: heightKm,
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude)
  };
};

/**
 * Calculates a series of points representing the satellite's orbit as a closed loop.
 * It calculates the orbital period and projects the path into a fixed Earth frame (ECF)
 * relative to the start time, creating a visual "Orbital Ring".
 */
export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];

  // 1. Calculate orbital period in minutes
  // satrec.no is mean motion in radians per minute.
  // Standard LEO period is around 90-100 mins.
  let periodMinutes = 96; // Default fallback
  const meanMotion = sat.satrec.no; 
  if (meanMotion && meanMotion > 0) {
    periodMinutes = (2 * Math.PI) / meanMotion;
  }

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  
  // 2. Use FIXED GMST at startTime. 
  // This ignores Earth's rotation during the loop generation, creating a 
  // closed ellipse (Orbit Plane) instead of a spiral ground track.
  const gmstFixed = satellite.gstime(startTime);

  // 3. Generate points
  // 180 segments provides good resolution for a circle/ellipse
  const segments = 180; 
  
  for (let i = 0; i <= segments; i++) {
    // Calculate time offset for this segment
    const fraction = i / segments;
    const timeOffsetMinutes = fraction * periodMinutes;
    
    // Propagate
    const date = new Date(startMs + timeOffsetMinutes * 60 * 1000);
    const positionAndVelocity = satellite.propagate(sat.satrec, date);
    const positionEci = positionAndVelocity.position;

    // Skip invalid points
    // positionEci might be false if error, or object
    if (!positionEci || typeof positionEci !== 'object') continue;

    // Convert using fixed GMST
    const positionEcf = satellite.eciToEcf(positionEci, gmstFixed);

    positions.push({
      x: positionEcf.x * 1000,
      y: positionEcf.y * 1000,
      z: positionEcf.z * 1000
    });
  }

  return positions;
};