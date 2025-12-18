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

let viewer: any = null;
let billboardsCollection: any = null;
let orbitPathPrimitive: any = null;
let beamPrimitive: any = null;
let isReady = false;

// 性能优化：预分配内存
let frameCount = 0;
let lastFpsUpdateTime = performance.now();
const scratchPosition = { x: 0, y: 0, z: 0, detailed: false };
let scratchCartesian: any = null;

onMounted(() => {
  if (!containerRef.value) return;
  const Cesium = window.Cesium;
  if (!Cesium) return;

  scratchCartesian = new Cesium.Cartesian3();

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
    // 关键配置：开启对数深度缓冲，解决大尺度下的渲染伪影（蜂窝状）
    contextOptions: {
      webgl: {
        alpha: false,
        depth: true,
        stencil: false,
        antialias: true,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false
      }
    },
    orderIndependentTranslucency: true,
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  // 场景级优化
  viewer.scene.logarithmicDepthBuffer = true;
  viewer.scene.globe.depthTestAgainstTerrain = false; // 严禁开启，除非有地形数据
  viewer.scene.highDynamicRange = false;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  
  viewer.clock.multiplier = props.playbackSpeed;

  billboardsCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection({
    scene: viewer.scene
  }));
  
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

const updateSatellites = () => {
  if (!isReady || !billboardsCollection) return;
  const Cesium = window.Cesium;
  billboardsCollection.removeAll();
  props.satellites.forEach(sat => {
    billboardsCollection.add({
      position: Cesium.Cartesian3.ZERO,
      image: SATELLITE_SVG,
      scale: 0.3,
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

  const len = billboardsCollection.length;

  for (let i = 0; i < len; i++) {
    const bb = billboardsCollection.get(i);
    const sat = bb.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    scratchPosition.detailed = isSelected;
    if (updateSatellitePositionResult(sat, now, scratchPosition)) {
      // 核心修复：必须通过 clone 赋值或直接赋值来触发 Billboard 的 Dirty Flag
      scratchCartesian.x = scratchPosition.x;
      scratchCartesian.y = scratchPosition.y;
      scratchCartesian.z = scratchPosition.z;
      
      // 触发 Setter
      bb.position = Cesium.Cartesian3.clone(scratchCartesian, bb.position);
      
      if (isSelected) {
        bb.color = Cesium.Color.YELLOW;
        bb.scale = 0.7;
        
        const pathPoints = getOrbitPath(sat, now);
        if (pathPoints.length > 0) {
          orbitPathPrimitive.positions = pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z));
        }

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