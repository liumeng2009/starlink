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
  const CACHE_KEY = 'starlink_tle_data';
  const CACHE_TIME_KEY = 'starlink_tle_timestamp';
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  // 1. Check LocalStorage Cache
  const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
  const cachedData = localStorage.getItem(CACHE_KEY);

  if (cachedTime && cachedData) {
    const age = Date.now() - parseInt(cachedTime, 10);
    if (age < CACHE_DURATION) {
      console.log(`Using cached TLE data (${(age / 1000 / 60).toFixed(1)} mins old)`);
      return parseTLE(cachedData);
    }
  }

  try {
    // Attempt to fetch live data from Celestrak
    // 'starlink' group on Celestrak is comprehensive.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // Increase timeout to 15s

    // 星历接口
    const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Celestrak API error: ${response.statusText}`);
    }
    
    const text = await response.text();
    
    // 2. Save to LocalStorage
    try {
      localStorage.setItem(CACHE_KEY, text);
      localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
    } catch (e) {
      console.warn("LocalStorage quota exceeded, cannot cache TLE data.");
    }

    return parseTLE(text); 

  } catch (error) {
    console.warn("Failed to fetch live TLEs (likely network or CORS restriction), switching to simulation mode.", error);
    
    // Fallback: Generate a large constellation for visualization
    const mockData = generateMockStarlinkTrain(10000, 70000);
    return parseTLE(mockData.join('\n'));
  }
};

export const parseTLE = (tleData: string): TLEData[] => {
  const lines = tleData.split(/\r?\n/).filter(line => line.trim() !== '');
  const satellites: TLEData[] = [];

  // Robust parser for 3-line TLE sets (Name, Line 1, Line 2)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect Line 1 of a TLE set
    if (line.startsWith('1 ') && (i + 1 < lines.length) && lines[i+1].startsWith('2 ')) {
      const line1 = line;
      const line2 = lines[i+1].trim();
      
      // Attempt to retrieve name from the preceding line
      let name = "Unknown Satellite";
      if (i > 0 && !lines[i-1].startsWith('1 ') && !lines[i-1].startsWith('2 ')) {
        name = lines[i-1].trim();
      } else {
         // If name is missing or file structure is non-standard, use ID
         name = `SAT-${line1.substring(2, 7)}`;
      }

      const catalogNumber = line1.substring(2, 7);
      
      satellites.push({
        name,
        line1,
        line2,
        catalogNumber
      });
      
      // Advance index since we consumed Line 2 (loop increments by 1, so we skip one extra)
      i++; 
    }
  }
  
  return satellites;
};