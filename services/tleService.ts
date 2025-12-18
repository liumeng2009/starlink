
import { TLEData } from '../types';

// Fallback mock data generator
const generateMockStarlinkTrain = (count: number, startId: number): string[] => {
  const tles: string[] = [];
  const baseInclination = 53.0;
  
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const raan = (i * 2.5) % 360; 
    const meanAnomaly = (i * 1.5) % 360; 
    
    const line1 = `1 ${id}U 19074A   24068.50000000  .00000000  00000-0  00000-0 0  9999`;
    const line2 = `2 ${id}  ${baseInclination.toFixed(4)} ${raan.toFixed(4)} 0001000  ${meanAnomaly.toFixed(4)} 350.0000 15.06400000    1`;
    
    tles.push(`STARLINK-${id} (MOCK)`);
    tles.push(line1);
    tles.push(line2);
  }
  return tles;
};

export const fetchStarlinkTLEs = async (): Promise<TLEData[]> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); 

    const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Celestrak API error: ${response.statusText}`);
    }
    
    const text = await response.text();
    // Limit to 500 as requested to check FPS upper limit
    return parseTLE(text).slice(0, 500);

  } catch (error) {
    console.warn("Failed to fetch live TLEs, switching to simulation mode.", error);
    const mockData = generateMockStarlinkTrain(500, 70000);
    return parseTLE(mockData.join('\n'));
  }
};

export const parseTLE = (tleData: string): TLEData[] => {
  const lines = tleData.split(/\r?\n/).filter(line => line.trim() !== '');
  const satellites: TLEData[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('1 ') && (i + 1 < lines.length) && lines[i+1].startsWith('2 ')) {
      const line1 = line;
      const line2 = lines[i+1].trim();
      let name = "Unknown Satellite";
      if (i > 0 && !lines[i-1].startsWith('1 ') && !lines[i-1].startsWith('2 ')) {
        name = lines[i-1].trim();
      } else {
         name = `SAT-${line1.substring(2, 7)}`;
      }
      const catalogNumber = line1.substring(2, 7);
      satellites.push({ name, line1, line2, catalogNumber });
      i++; 
    }
  }
  return satellites;
};
