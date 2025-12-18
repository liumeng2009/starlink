<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { SatelliteInfo } from '../types';
import { getSatellitePosition, getOrbitPath } from '../services/orbitService';

const props = defineProps<{
  satellites: SatelliteInfo[];
  selectedSatelliteId: string | null;
  playbackSpeed: number;
  isPaused: boolean;
  manualTime: Date | null;
  sceneMode: '3D' | '2D';
}>();

const emit = defineEmits<{
  (e: 'satelliteClick', id: string | null): void;
  (e: 'tick', date: Date): void;
  (e: 'update:fps', value: number): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);

// Cesium internals
let viewer: any = null;
let pointsCollection: any = null;
let orbitPathCollection: any = null;
let beamCollection: any = null;
let groundStationsCollection: any = null;
let dataLinksCollection: any = null;
let isReady = false;

// FPS tracking
let frameCount = 0;
let lastFpsUpdateTime = performance.now();

// Washington Ground Stations (Hexagonal Grid)
const WA_CENTER = { lat: 47.6, lon: -121.5 };
const HEX_RADIUS = 0.4; // degrees
const groundStations = [
  { lat: WA_CENTER.lat, lon: WA_CENTER.lon, name: "WA-CORE-01" },
  { lat: WA_CENTER.lat + HEX_RADIUS, lon: WA_CENTER.lon, name: "WA-NORTH-02" },
  { lat: WA_CENTER.lat - HEX_RADIUS, lon: WA_CENTER.lon, name: "WA-SOUTH-03" },
  { lat: WA_CENTER.lat + HEX_RADIUS/2, lon: WA_CENTER.lon + HEX_RADIUS, name: "WA-NE-04" },
  { lat: WA_CENTER.lat - HEX_RADIUS/2, lon: WA_CENTER.lon + HEX_RADIUS, name: "WA-SE-05" },
  { lat: WA_CENTER.lat + HEX_RADIUS/2, lon: WA_CENTER.lon - HEX_RADIUS, name: "WA-NW-06" },
  { lat: WA_CENTER.lat - HEX_RADIUS/2, lon: WA_CENTER.lon - HEX_RADIUS, name: "WA-SW-07" },
];

// Threshold for communication (approx meters)
const COMM_RANGE = 600000; 

onMounted(() => {
  if (!containerRef.value) return;

  const Cesium = window.Cesium;
  if (!Cesium) return;

  try {
    Cesium.buildModuleUrl.setBaseUrl("https://unpkg.com/cesium@1.114.0/Build/Cesium/");
  } catch (e) {}

  viewer = new Cesium.Viewer(containerRef.value, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    creditContainer: document.createElement('div'),
    shouldAnimate: !props.isPaused, 
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  viewer.clock.multiplier = props.playbackSpeed;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());

  viewer.scene.globe.enableLighting = true;
  viewer.scene.highDynamicRange = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;

  // Primitive Collections
  pointsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  orbitPathCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  dataLinksCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  
  // Custom collection for ground station markers
  groundStationsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  initGroundStations();

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: any) => {
    const pickedObject = viewer.scene.pick(movement.position);
    if (Cesium.defined(pickedObject) && pickedObject.id) {
      emit('satelliteClick', pickedObject.id.id);
    } else {
      emit('satelliteClick', null);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  viewer.clock.onTick.addEventListener(onTick);
  
  const fpsLoop = (now: number) => {
    if (!isReady) return;
    frameCount++;
    if (now - lastFpsUpdateTime > 1000) {
      emit('update:fps', Math.round((frameCount * 1000) / (now - lastFpsUpdateTime)));
      frameCount = 0;
      lastFpsUpdateTime = now;
    }
    requestAnimationFrame(fpsLoop);
  };
  requestAnimationFrame(fpsLoop);

  isReady = true;
  updateSatellites();
});

const initGroundStations = () => {
  const Cesium = window.Cesium;
  groundStations.forEach(gs => {
    const pos = Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat);
    groundStationsCollection.add({
      position: pos,
      pixelSize: 10,
      color: Cesium.Color.CYAN.withAlpha(0.8),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    });

    // Add a small decorative hexagon ring
    viewer.entities.add({
      position: pos,
      ellipse: {
        semiMinorAxis: 15000,
        semiMajorAxis: 15000,
        material: Cesium.Color.CYAN.withAlpha(0.1),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.5),
        outlineWidth: 2
      }
    });
  });
};

const updateSatellites = () => {
  if (!isReady || !props.satellites.length) return;
  const Cesium = window.Cesium;
  pointsCollection.removeAll();
  props.satellites.forEach(sat => {
    pointsCollection.add({
      position: Cesium.Cartesian3.ZERO,
      pixelSize: 4,
      color: Cesium.Color.fromCssColorString('#06b6d4'),
      id: sat,
    });
  });
};

const onTick = (clock: any) => {
  if (!pointsCollection || !isReady) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  dataLinksCollection.removeAll();
  const len = pointsCollection.length;
  
  // Pre-calculate ground station Cartesian positions
  const gsCartesians = groundStations.map(gs => Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat));

  for (let i = 0; i < len; i++) {
    const point = pointsCollection.get(i);
    const sat = point.id as SatelliteInfo; 
    const data = getSatellitePosition(sat, now);
    
    if (data) {
      const position = new Cesium.Cartesian3(data.x, data.y, data.z);
      point.position = position;
      
      // Proximity check for Washington Ground Stations
      // To optimize: only check satellites with roughly correct longitude
      if (data.lon > -130 && data.lon < -110 && data.lat > 40 && data.lat < 55) {
        gsCartesians.forEach(gsPos => {
          const dist = Cesium.Cartesian3.distance(position, gsPos);
          if (dist < COMM_RANGE) {
            dataLinksCollection.add({
              positions: [position, gsPos],
              width: 1.5,
              material: Cesium.Material.fromType('PolylineGlow', {
                glowPower: 0.1,
                color: Cesium.Color.CYAN.withAlpha(0.6)
              })
            });
          }
        });
      }

      if (props.selectedSatelliteId && sat.id === props.selectedSatelliteId) {
        point.color = Cesium.Color.YELLOW;
        point.pixelSize = 10;
        
        if (beamCollection.length > 0) {
          const beam = beamCollection.get(0);
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          cartographic.height = 0;
          const surfacePosition = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
          beam.positions = [position, surfacePosition];
        }
      } else {
        point.color = Cesium.Color.fromCssColorString('#06b6d4');
        point.pixelSize = 4;
      }
    }
  }
};

watch(() => props.satellites, updateSatellites);
watch(() => props.selectedSatelliteId, () => {
  if (!isReady) return;
  const Cesium = window.Cesium;
  orbitPathCollection.removeAll();
  beamCollection.removeAll();

  if (props.selectedSatelliteId) {
    const sat = props.satellites.find(s => s.id === props.selectedSatelliteId);
    if (sat) {
      const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      const pathPoints = getOrbitPath(sat, now);
      if (pathPoints.length > 1) {
        orbitPathCollection.add({
          positions: pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z)),
          width: 2,
          material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.4) })
        });
      }
      beamCollection.add({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
        width: 2,
        material: Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.CYAN })
      });
    }
  }
});

watch(() => props.playbackSpeed, s => viewer && (viewer.clock.multiplier = s));
watch(() => props.isPaused, p => viewer && (viewer.clock.shouldAnimate = !p));
watch(() => props.sceneMode, m => {
  if (!viewer) return;
  m === '2D' ? viewer.scene.morphTo2D(1.0) : viewer.scene.morphTo3D(1.0);
});
</script>

<template>
  <div ref="containerRef" class="w-full h-full"></div>
</template>