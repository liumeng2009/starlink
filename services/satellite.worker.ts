/// <reference lib="webworker" />

import * as satellite from 'satellite.js';

let satrecs: any[] = [];
let satelliteIds: string[] = [];

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'init') {
    const tles = payload; // Expecting array of { catalogNumber, line1, line2 }
    satrecs = [];
    satelliteIds = [];
    
    tles.forEach((tle: any) => {
      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        satrecs.push(satrec);
        satelliteIds.push(tle.catalogNumber);
      } catch (err) {
        // Ignore bad TLEs
      }
    });

    self.postMessage({ type: 'init-complete', count: satrecs.length });
  } else if (type === 'propagate') {
    const { date } = payload;
    const positions = new Float32Array(satrecs.length * 3);
    const dateObj = new Date(date);
    
    // Optimization: Pre-calculate GMST
    const gmst = satellite.gstime(dateObj);

    for (let i = 0; i < satrecs.length; i++) {
      const satrec = satrecs[i];
      // Propagate
      const positionAndVelocity = satellite.propagate(satrec, dateObj);
      const positionEci = positionAndVelocity.position;

      if (positionEci && typeof positionEci !== 'boolean') {
        // ECI to ECF
        const positionEcf = satellite.eciToEcf(positionEci, gmst);
        
        // Store in flat array [x, y, z, x, y, z, ...]
        // Convert km to meters here to save main thread work
        positions[i * 3] = positionEcf.x * 1000;
        positions[i * 3 + 1] = positionEcf.y * 1000;
        positions[i * 3 + 2] = positionEcf.z * 1000;
      } else {
        // Invalid position (e.g. decayed)
        positions[i * 3] = NaN;
        positions[i * 3 + 1] = NaN;
        positions[i * 3 + 2] = NaN;
      }
    }

    // Transfer the buffer to avoid copying
    self.postMessage({ 
      type: 'propagate-result', 
      positions,
      ids: satelliteIds 
    }, [positions.buffer]);
  }
};
