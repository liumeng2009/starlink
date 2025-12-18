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

export const updateSatellitePositionResult = (sat: SatelliteInfo, date: Date, result: any) => {
  if (!satellite) return false;
  
  const positionAndVelocity = satellite.propagate(sat.satrec, date);
  const positionEci = positionAndVelocity.position;

  if (!positionEci || typeof positionEci !== 'object') return false;

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  
  result.x = positionEcf.x * 1000;
  result.y = positionEcf.y * 1000;
  result.z = positionEcf.z * 1000;
  
  if (result.detailed) {
    const velocityEci = positionAndVelocity.velocity;
    if (velocityEci) {
        result.velocity = Math.sqrt(velocityEci.x * velocityEci.x + velocityEci.y * velocityEci.y + velocityEci.z * velocityEci.z);
    }
    const geodetic = satellite.eciToGeodetic(positionEci, gmst);
    result.height = geodetic.height;
    result.lat = satellite.degreesLat(geodetic.latitude);
    result.lon = satellite.degreesLong(geodetic.longitude);
  }
  
  return true;
};

export const getSatellitePosition = (sat: SatelliteInfo, date: Date) => {
  const res = { x: 0, y: 0, z: 0, velocity: 0, height: 0, lat: 0, lon: 0, detailed: true };
  if (updateSatellitePositionResult(sat, date, res)) return res;
  return null;
};

export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];
  const meanMotionRadMin = sat.satrec.no; 
  const periodMinutes = (2 * Math.PI) / meanMotionRadMin;

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  const segments = 45; // 进一步平衡精度与性能
  
  for (let i = 0; i <= segments; i++) {
    const futureDate = new Date(startMs + (i / segments) * periodMinutes * 60000);
    const gmst = satellite.gstime(futureDate);
    const pv = satellite.propagate(sat.satrec, futureDate);
    const posEci = pv.position;

    if (posEci && typeof posEci === 'object') {
      const posEcf = satellite.eciToEcf(posEci, gmst);
      positions.push({ x: posEcf.x * 1000, y: posEcf.y * 1000, z: posEcf.z * 1000 });
    }
  }
  return positions;
};