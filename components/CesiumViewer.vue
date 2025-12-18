<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
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

// 定义缺失的地面站数据
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
let beamCollection: any = null;
let groundStationsCollection: any = null;
let dataLinksCollection: any = null;
let isReady = false;

// 性能优化相关的变量
let frameCount = 0;
let lastFpsUpdateTime = performance.now();
let updateTicket = 0;
const BATCH_SIZE = 4; // 适度调整批次
const scratchPosition = { x: 0, y: 0, z: 0, detailed: false };
let scratchCartesian: any;
let occluder: any;
let cullingVolume: any;
let boundingSphere: any;

onMounted(() => {
  if (!containerRef.value) return;
  const Cesium = window.Cesium;
  if (!Cesium) return;

  scratchCartesian = new Cesium.Cartesian3();
  // 卫星的大致包围球
  boundingSphere = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 1000.0);

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
  viewer.scene.highDynamicRange = false;
  
  // 核心修复：启用深度检测，解决地球透明问题，让地球能遮挡卫星
  viewer.scene.globe.depthTestAgainstTerrain = true;

  billboardsCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection({
    scene: viewer.scene
  }));
  
  beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  dataLinksCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  groundStationsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  
  const orbitPolylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  orbitPathPrimitive = orbitPolylines.add({
    positions: [],
    width: 2.0,
    material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.7) })
  });

  initGroundStations();

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: any) => {
    const pickedObject = viewer.scene.pick(movement.position);
    if (Cesium.defined(pickedObject) && pickedObject.id) {
      // 只有当前可见（未被剔除）的对象才能被选中
      if (pickedObject.primitive.show !== false) {
        emit('satelliteClick', pickedObject.id.id);
      }
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
    groundStationsCollection.add({
      position: Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat),
      pixelSize: 8,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2
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
      scale: 0.35,
      color: window.Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.7),
      id: sat,
      // 确保这里没有设置 disableDepthTestDistance
    });
  });
};

const onTick = (clock: any) => {
  if (!billboardsCollection || !isReady) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  dataLinksCollection.removeAll();
  
  // 更新遮挡器和视锥体
  occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, viewer.camera.position);
  cullingVolume = viewer.scene.frameState.cullingVolume;

  const len = billboardsCollection.length;
  const step = updateTicket % BATCH_SIZE;
  updateTicket++;

  for (let i = 0; i < len; i++) {
    const bb = billboardsCollection.get(i);
    const sat = bb.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    const prevPos = bb.position;
    boundingSphere.center = prevPos;
    
    // 计算可见性
    const isOutsideFrustum = cullingVolume.computeVisibility(boundingSphere) === Cesium.Intersect.OUTSIDE;
    const isOccluded = !occluder.isPointVisible(prevPos);
    const isVisible = !isOutsideFrustum && !isOccluded;

    // 同步显示状态：不可见且非选中的卫星，直接隐藏
    // 这解决了选中背面卫星的问题
    bb.show = isVisible || isSelected;

    // 性能分片：不可见卫星降低更新频率
    if (!isVisible && !isSelected) {
        if (i % BATCH_SIZE !== step) continue;
    }

    scratchPosition.detailed = isSelected;
    if (updateSatellitePositionResult(sat, now, scratchPosition)) {
      scratchCartesian.x = scratchPosition.x;
      scratchCartesian.y = scratchPosition.y;
      scratchCartesian.z = scratchPosition.z;
      bb.position = scratchCartesian;
      
      if (isSelected) {
        bb.color = Cesium.Color.YELLOW;
        bb.scale = 0.8;
        
        const pathPoints = getOrbitPath(sat, now);
        if (pathPoints.length > 0) {
          orbitPathPrimitive.positions = pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z));
        }

        if (beamCollection.length > 0) {
          const beam = beamCollection.get(0);
          const carto = Cesium.Cartographic.fromCartesian(scratchCartesian);
          beam.positions = [
            scratchCartesian, 
            Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0)
          ];
        }
      } else {
        bb.color = Cesium.Color.fromCssColorString('#06b6d4').withAlpha(0.7);
        bb.scale = 0.35;
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
      width: 1.0,
      material: Cesium.Material.fromType('PolylineGlow', { color: Cesium.Color.CYAN.withAlpha(0.5) })
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