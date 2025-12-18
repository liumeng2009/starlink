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

// 卫星 SVG 图标
const SATELLITE_SVG = `data:image/svg+xml;base64,${btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 9L2 14L5 17L10 12M12 10L17 5L20 8L15 13M9 22L12 19M19 12L22 9M12 12L15 15M13 11L14 10M11 13L10 14" />
  <circle cx="12" cy="12" r="2" fill="white" />
</svg>`)}`;

let viewer: any = null;
let billboardsCollection: any = null;
let orbitPathPrimitive: any = null;
let beamCollection: any = null;
let groundStationsCollection: any = null;
let dataLinksCollection: any = null;
let isReady = false;

let frameCount = 0;
let lastFpsUpdateTime = performance.now();
let updateTicket = 0; 
const BATCH_COUNT = 4; // 分 4 组更新以提升性能

const groundStations = [
  { lat: 47.6, lon: -121.5 },
  { lat: 48.0, lon: -121.5 },
  { lat: 47.2, lon: -121.5 },
  { lat: 47.8, lon: -120.7 },
  { lat: 47.4, lon: -120.7 },
  { lat: 47.8, lon: -122.3 },
  { lat: 47.4, lon: -122.3 },
];
const COMM_RANGE = 600000; 

onMounted(() => {
  if (!containerRef.value) return;
  const Cesium = window.Cesium;
  if (!Cesium) return;

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

  // 初始化集合
  billboardsCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection());
  beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  dataLinksCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  groundStationsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  
  const orbitPolylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  orbitPathPrimitive = orbitPolylines.add({
    positions: [],
    width: 2.0,
    material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.4) })
  });

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
  if (props.satellites.length > 0) {
    updateSatellites();
  }
});

const initGroundStations = () => {
  const Cesium = window.Cesium;
  groundStations.forEach(gs => {
    const pos = Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat);
    groundStationsCollection.add({
      position: pos,
      pixelSize: 8,
      color: Cesium.Color.CYAN.withAlpha(0.9),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
    });
  });
};

const updateSatellites = () => {
  if (!isReady || !billboardsCollection) return;
  const Cesium = window.Cesium;
  billboardsCollection.removeAll();
  
  props.satellites.forEach(sat => {
    billboardsCollection.add({
      position: Cesium.Cartesian3.ZERO,
      image: SATELLITE_SVG,
      scale: 0.4,
      color: Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.8),
      id: sat,
    });
  });
};

const onTick = (clock: any) => {
  if (!billboardsCollection || !isReady) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  dataLinksCollection.removeAll();
  const gsCartesians = groundStations.map(gs => Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat));
  
  const currentBatch = updateTicket % BATCH_COUNT;
  updateTicket++;

  // 关键修复：正确获取集合长度，不要使用外部的 len 变量
  const len = billboardsCollection.length;
  
  for (let i = 0; i < len; i++) {
    const bb = billboardsCollection.get(i);
    const sat = bb.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    // 性能优化：分帧更新，但选中的卫星每帧必更
    if (i % BATCH_COUNT !== currentBatch && !isSelected) continue;

    const data = getSatellitePosition(sat, now);
    if (data) {
      const position = new Cesium.Cartesian3(data.x, data.y, data.z);
      bb.position = position;
      
      if (isSelected) {
        bb.color = Cesium.Color.YELLOW;
        bb.scale = 1.0;
        
        // 实时更新轨道路径，确保重合
        const pathPoints = getOrbitPath(sat, now);
        if (pathPoints.length > 0) {
          orbitPathPrimitive.positions = pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z));
        }

        if (beamCollection.length > 0) {
          const beam = beamCollection.get(0);
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          cartographic.height = 0;
          beam.positions = [position, Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0)];
        }
      } else {
        bb.color = Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.8);
        bb.scale = 0.4;
      }

      // 飞线粗筛
      if (data.lon > -130 && data.lon < -110 && data.lat > 40 && data.lat < 55) {
        gsCartesians.forEach(gsPos => {
          if (Cesium.Cartesian3.distance(position, gsPos) < COMM_RANGE) {
            dataLinksCollection.add({
              positions: [position, gsPos],
              width: 1.0,
              material: Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.CYAN.withAlpha(0.4) })
            });
          }
        });
      }
    }
  }
};

watch(() => props.satellites, updateSatellites);
watch(() => props.selectedSatelliteId, (id) => {
  if (!isReady) return;
  if (!id) {
    orbitPathPrimitive.positions = [];
    beamCollection.removeAll();
  } else {
    const Cesium = window.Cesium;
    beamCollection.removeAll();
    beamCollection.add({
      positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
      width: 1.5,
      material: Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.CYAN.withAlpha(0.8) })
    });
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