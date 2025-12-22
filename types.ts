export interface TLEData {
  name: string;
  line1: string;
  line2: string;
  catalogNumber: string;
}

export interface SatellitePosition {
  x: number;
  y: number;
  z: number;
}

export interface SatelliteInfo {
  id: string; // usually catalog number
  name: string;
  tle: TLEData;
  satrec: any; // satellite.js SatRec object
  position?: SatellitePosition;
  velocity?: number; // km/s
  height?: number; // km
}

// Cesium Global Type Augmentation
declare global {
  interface Window {
    // Cesium: any; // Removed as we are using npm package
    satellite: any;
  }
}
