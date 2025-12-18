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
  const vel = Math.sqrt(Math.pow(velocityEci.x, 2) + Math.pow(velocityEci.y, 2) + Math.pow(velocityEci.z, 2));
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

/**
 * 获取瞬时轨道路径（闭合椭圆）
 */
export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];

  // 获取当前的恒星时，作为整条轨道线的参考坐标系
  const gmst = satellite.gstime(startTime);
  
  // 计算轨道周期 (分钟)
  const meanMotionRadMin = sat.satrec.no; 
  const periodMinutes = (2 * Math.PI) / meanMotionRadMin;

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  const segments = 120; // 采样点数量
  
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const offsetMs = fraction * periodMinutes * 60 * 1000;
    const futureDate = new Date(startMs + offsetMs);
    
    const pv = satellite.propagate(sat.satrec, futureDate);
    const posEci = pv.position;

    if (posEci && typeof posEci === 'object') {
      // 关键改进：使用固定的 gmst 转换所有点
      // 这会生成一个在当前地球坐标系下的静态轨道环，消除自转导致的“缺口”
      const posEcf = satellite.eciToEcf(posEci, gmst);

      positions.push({
        x: posEcf.x * 1000,
        y: posEcf.y * 1000,
        z: posEcf.z * 1000
      });
    }
  }

  // 强制闭合：SGP4 哪怕在一个周期内也会因为摄动产生极小的漂移，这里手动闭合
  if (positions.length > 0) {
    positions[positions.length - 1] = { ...positions[0] };
  }

  return positions;
};