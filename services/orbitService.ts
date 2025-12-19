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

export const getSatellitePositionAndVelocity = (sat: SatelliteInfo, date: Date) => {
  if (!satellite) return null;

  // 1. Propagate at current time
  const posVel = satellite.propagate(sat.satrec, date);
  const posEci = posVel.position;
  const velEci = posVel.velocity;

  if (!posEci || !velEci) return null;

  const gmst = satellite.gstime(date);
  const posEcf = satellite.eciToEcf(posEci, gmst);

  // 2. Propagate slightly in future to estimate ECF velocity
  // 0.1 second delta for better precision? 1s is fine for visual.
  // Let's use 0.5s to match the update rate roughly, but 1s is standard for velocity.
  const dt = 1.0; // seconds
  const dateNext = new Date(date.getTime() + dt * 1000);
  const posVelNext = satellite.propagate(sat.satrec, dateNext);
  const posEciNext = posVelNext.position;
  
  if (!posEciNext) return null;

  const gmstNext = satellite.gstime(dateNext);
  const posEcfNext = satellite.eciToEcf(posEciNext, gmstNext);

  // Calculate velocity vector in m/s (satellite.js uses km)
  const vx = ((posEcfNext.x - posEcf.x) / dt) * 1000;
  const vy = ((posEcfNext.y - posEcf.y) / dt) * 1000;
  const vz = ((posEcfNext.z - posEcf.z) / dt) * 1000;

  // 3. Calculate Height/Velocity for UI (same as before)
  const vel = Math.sqrt(
    Math.pow(velEci.x, 2) + 
    Math.pow(velEci.y, 2) + 
    Math.pow(velEci.z, 2)
  );

  const geodetic = satellite.eciToGeodetic(posEci, gmst);
  const heightKm = geodetic.height;

  return {
    x: posEcf.x * 1000,
    y: posEcf.y * 1000,
    z: posEcf.z * 1000,
    vx,
    vy,
    vz,
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
  // 360 segments for smoother circle
  const segments = 360; 
  
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

  // 4. Smooth Loop Closure
  // Due to orbital perturbations (J2 etc), the satellite doesn't return to the exact same 
  // inertial position after one period. We distribute this "gap" error across the path
  // to create a visually perfect closed loop.
  if (positions.length > 1) {
    const first = positions[0];
    const last = positions[positions.length - 1];
    
    const gap = {
      x: last.x - first.x,
      y: last.y - first.y,
      z: last.z - first.z
    };

    // Adjust all points except the first one (which is the anchor)
    // The last point will be adjusted by exactly -gap, making it equal to first point.
    for (let i = 1; i < positions.length; i++) {
      const weight = i / (positions.length - 1);
      positions[i].x -= gap.x * weight;
      positions[i].y -= gap.y * weight;
      positions[i].z -= gap.z * weight;
    }
  }

  return positions;
};

/**
 * Pre-calculates the orbit path in ECI (Inertial) coordinates.
 * This is expensive (SGP4 propagation) and should be done once when satellite is selected.
 */
export const getOrbitPathECI = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];

  let periodMinutes = 96;
  const meanMotion = sat.satrec.no; 
  if (meanMotion && meanMotion > 0) {
    periodMinutes = (2 * Math.PI) / meanMotion;
  }

  const eciPoints: any[] = [];
  const startMs = startTime.getTime();
  const segments = 360; 
  
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const timeOffsetMinutes = fraction * periodMinutes;
    const date = new Date(startMs + timeOffsetMinutes * 60 * 1000);
    const positionAndVelocity = satellite.propagate(sat.satrec, date);
    const positionEci = positionAndVelocity.position;

    if (!positionEci || typeof positionEci !== 'object') continue;
    eciPoints.push(positionEci);
  }

  // Smooth Loop Closure in ECI
  if (eciPoints.length > 1) {
    const first = eciPoints[0];
    const last = eciPoints[eciPoints.length - 1];
    const gap = { x: last.x - first.x, y: last.y - first.y, z: last.z - first.z };

    for (let i = 1; i < eciPoints.length; i++) {
      const weight = i / (eciPoints.length - 1);
      eciPoints[i].x -= gap.x * weight;
      eciPoints[i].y -= gap.y * weight;
      eciPoints[i].z -= gap.z * weight;
    }
  }

  return eciPoints;
};

/**
 * Efficiently transforms cached ECI points to ECF for the current frame time.
 * This avoids re-running SGP4 propagation.
 */
export const getOrbitPathECF = (eciPoints: any[], currentTime: Date) => {
  if (!satellite || !eciPoints.length) return [];
  
  const gmst = satellite.gstime(currentTime);
  const positions: {x: number, y: number, z: number}[] = [];

  for (let i = 0; i < eciPoints.length; i++) {
    const eci = eciPoints[i];
    const ecf = satellite.eciToEcf(eci, gmst);
    positions.push({
      x: ecf.x * 1000,
      y: ecf.y * 1000,
      z: ecf.z * 1000
    });
  }
  return positions;
};