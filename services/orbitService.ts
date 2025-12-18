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

  if (!positionEci || !velocityEci) return null;

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
 * 动态预测轨道路径
 * 解决不重合问题：为路径上的每个点计算对应的未来时刻 GMST
 */
export const getOrbitPath = (sat: SatelliteInfo, startTime: Date) => {
  if (!satellite) return [];

  // 计算精确的轨道周期 (分钟)
  // satrec.no 是平均运动 (弧度/分钟)
  const meanMotionRadMin = sat.satrec.no; 
  const periodMinutes = (2 * Math.PI) / meanMotionRadMin;

  const positions: {x: number, y: number, z: number}[] = [];
  const startMs = startTime.getTime();
  
  // 使用较高的采样率以保证曲线平滑
  const segments = 120; 
  
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    const offsetMs = fraction * periodMinutes * 60 * 1000;
    const futureDate = new Date(startMs + offsetMs);
    
    const pv = satellite.propagate(sat.satrec, futureDate);
    const posEci = pv.position;

    if (posEci && typeof posEci === 'object') {
      // 关键优化：使用该点对应未来时刻的 gmst，而不是固定的 startTime gmst
      // 这能让轨道考虑地球自转，与卫星实际运行轨迹完全一致
      const gmst = satellite.gstime(futureDate);
      const posEcf = satellite.eciToEcf(posEci, gmst);

      positions.push({
        x: posEcf.x * 1000,
        y: posEcf.y * 1000,
        z: posEcf.z * 1000
      });
    }
  }

  return positions;
};