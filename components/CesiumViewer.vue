<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { SatelliteInfo } from '../types';
import { updateSatellitePositionResult, getOrbitPath } from '../services/orbitService';

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

const SATELLITE_SVG = `data:image/svg+xml;base64,${btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M7 9L2 14L5 17L10 12M12 10L17 5L20 8L15 13M9 22L12 19M19 12L22 9M12 12L15 15M13 11L14 10M11 13L10 14" />
  <circle cx="12" cy="12" r="2" fill="white" />
</svg>`)}`;

const groundStations = [
  { lat: 47.6, lon: -122.3, name: "Seattle" },
  { lat: 34.0, lon: -118.2, name: "Los Angeles" },
  { lat: 40.7, lon: -74.0, name: "New York" },
  { lat: 51.5, lon: -0.1, name: "London" },
  { lat: 35.6, lon: 139.6, name: "Tokyo" },
  { lat: 22.3, lon: 114.1, name: "Hong Kong" },
  { lat: -33.8, lon: 151.2, name: "Sydney" }
];

let viewer: any = null;
let billboardsCollection: any = null;
let orbitPathPrimitive: any = null;
let beamPrimitive: any = null;
let isReady = false;

// 性能优化状态
let frameCount = 0;
let lastFpsUpdateTime = performance.now();
let batchIndex = 0;
const BATCH_COUNT = 4; // 将所有卫星分为4组，轮流更新位置
const scratchPosition = { x: 0, y: 0, z: 0, detailed: false };
const scratchCartesian = { x: 0, y: 0, z: 0 };

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
    requestRenderMode: false,
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  viewer.clock.multiplier = props.playbackSpeed;
  viewer.scene.globe.enableLighting = true;
  
  // 重要：关闭 depthTestAgainstTerrain。
  // 在没有加载精确地形的情况下，开启它会导致严重的深度图伪影（蜂窝状分布）。
  viewer.scene.globe.depthTestAgainstTerrain = false;

  billboardsCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection());
  
  const orbitPolylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  orbitPathPrimitive = orbitPolylines.add({
    positions: [],
    width: 2.0,
    material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.6) })
  });

  const beamPolylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  beamPrimitive = beamPolylines.add({
    positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
    width: 1.0,
    material: Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.CYAN.withAlpha(0.4) }),
    show: false
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
  updateSatellites();
});

const initGroundStations = () => {
  const Cesium = window.Cesium;
  const collection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  groundStations.forEach(gs => {
    collection.add({
      position: Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat),
      pixelSize: 6,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1
    });
  });
};

const updateSatellites = () => {
  if (!isReady || !billboardsCollection) return;
  billboardsCollection.removeAll();
  props.satellites.forEach(sat => {
    billboardsCollection.add({
      position: window.Cesium.Cartesian3.ZERO,
      image: SATELLITE_SVG,
      scale: 0.3,
      color: window.Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.8),
      id: sat,
      // 深度检测依然由 Cesium 自动处理（卫星进入地球背面会自动消失）
    });
  });
};

const onTick = (clock: any) => {
  if (!billboardsCollection || !isReady) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  const len = billboardsCollection.length;
  // 计算当前批次的范围
  const batchSize = Math.ceil(len / BATCH_COUNT);
  const start = batchIndex * batchSize;
  const end = Math.min(start + batchSize, len);
  
  batchIndex = (batchIndex + 1) % BATCH_COUNT;

  for (let i = 0; i < len; i++) {
    const bb = billboardsCollection.get(i);
    const sat = bb.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    // 如果不是当前批次且未被选中，则跳过计算（保持上一帧位置）
    if (!isSelected && (i < start || i >= end)) continue;

    scratchPosition.detailed = isSelected;
    if (updateSatellitePositionResult(sat, now, scratchPosition)) {
      // 直接修改 Cartesian3 属性，极速更新
      bb.position.x = scratchPosition.x;
      bb.position.y = scratchPosition.y;
      bb.position.z = scratchPosition.z;
      
      if (isSelected) {
        bb.color = Cesium.Color.YELLOW;
        bb.scale = 0.7;
        
        // 更新轨道路径
        const pathPoints = getOrbitPath(sat, now);
        if (pathPoints.length > 0) {
          const cartesianPoints = pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z));
          orbitPathPrimitive.positions = cartesianPoints;
        }

        // 更新波束
        const carto = Cesium.Cartographic.fromCartesian(bb.position);
        beamPrimitive.positions = [
          bb.position, 
          Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0)
        ];
        beamPrimitive.show = true;
      } else {
        bb.color = Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.8);
        bb.scale = 0.3;
      }
    }
  }
};

watch(() => props.satellites, updateSatellites);
watch(() => props.selectedSatelliteId, (id) => {
  if (!isReady) return;
  if (!id) {
    orbitPathPrimitive.positions = [];
    beamPrimitive.show = false;
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