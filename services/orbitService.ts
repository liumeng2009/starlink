import { SatelliteInfo, TLEData } from '../types';

const satellite = window.satellite;

// 预分配复用对象
const scratchGeodetic = { longitude: 0, latitude: 0, height: 0 };

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

/**
 * 优化后的坐标计算，支持结果对象复用
 */
export const updateSatellitePositionResult = (sat: SatelliteInfo, date: Date, result: any) => {
  if (!satellite) return false;
  
  const positionAndVelocity = satellite.propagate(sat.satrec, date);
  const positionEci = positionAndVelocity.position;
  const velocityEci = positionAndVelocity.velocity;

  if (!positionEci || !velocityEci || typeof positionEci !== 'object') return false;

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(positionEci, gmst);
  
  // 直接更新传入的对象，避免新对象分配
  result.x = positionEcf.x * 1000;
  result.y = positionEcf.y * 1000;
  result.z = positionEcf.z * 1000;
  
  // 仅在选中时才计算这些昂贵的数据
  if (result.detailed) {
    const vel = Math.sqrt(Math.pow(velocityEci.x, 2) + Math.pow(velocityEci.y, 2) + Math.pow(velocityEci.z, 2));
    const geodetic = satellite.eciToGeodetic(positionEci, gmst);
    result.velocity = vel;
    result.height = geodetic.height;
    result.lat = satellite.degreesLat(geodetic.latitude);
    result.lon = satellite.degreesLong(geodetic.longitude);
  }
  
  return true;
};

// 保留此导出用于 Overlay 的简单调用，但内部已优化
export const getSatellitePosition = (sat: SatelliteInfo, date: Date) => {
  const res = { x: 0, y: 0, z: 0, velocity: 0, height: 0, lat: 0, lon: 0, detailed: true };
  if (updateSatellitePositionResult(sat, date, res)) return res;
  return null;
};

export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];
  const gmst = satellite.gstime(startTime);
  const meanMotionRadMin = sat.satrec.no; 
  const periodMinutes = (2 * Math.PI) / meanMotionRadMin;

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  const segments = 90; // 适当降低采样点以提升选中时的性能
  
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const offsetMs = fraction * periodMinutes * 60 * 1000;
    const futureDate = new Date(startMs + offsetMs);
    const pv = satellite.propagate(sat.satrec, futureDate);
    const posEci = pv.position;

    if (posEci && typeof posEci === 'object') {
      const posEcf = satellite.eciToEcf(posEci, gmst);
      positions.push({ x: posEcf.x * 1000, y: posEcf.y * 1000, z: posEcf.z * 1000 });
    }
  }
  if (positions.length > 0) positions[positions.length - 1] = { ...positions[0] };
  return positions;
};