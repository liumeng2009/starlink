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

// Cesium 核心对象
let viewer: any = null;
let pointsCollection: any = null;
let orbitPathCollection: any = null;
let beamCollection: any = null;
let groundStationsCollection: any = null;
let dataLinksCollection: any = null;
let isReady = false;

// 性能优化控制变量
let frameCount = 0;
let lastFpsUpdateTime = performance.now();
let updateTicket = 0; // 用于分帧更新的计数器
const BATCH_COUNT = 4; // 将卫星分为4组，每帧更新一组 (大幅降低 CPU 压力)

// 华盛顿地面站配置
const WA_CENTER = { lat: 47.6, lon: -121.5 };
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
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  // 性能微调：禁用大气层等高耗能效果（如需极致性能）
  // viewer.scene.skyAtmosphere.show = false;

  pointsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  orbitPathCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  dataLinksCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
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
      pixelSize: 8,
      color: Cesium.Color.CYAN.withAlpha(0.9),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1,
    });

    // 蜂窝装饰
    viewer.entities.add({
      position: pos,
      ellipse: {
        semiMinorAxis: 20000,
        semiMajorAxis: 20000,
        material: Cesium.Color.CYAN.withAlpha(0.05),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.3),
        outlineWidth: 1
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
      pixelSize: 3, // 稍微缩小点，高密度下视觉更清爽
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

  // 飞线更新逻辑：每帧清空，重新按需生成
  dataLinksCollection.removeAll();
  
  const len = pointsCollection.length;
  const gsCartesians = groundStations.map(gs => Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat));
  
  // 分帧逻辑：计算当前帧需要处理的卫星索引范围
  const currentBatch = updateTicket % BATCH_COUNT;
  updateTicket++;

  for (let i = 0; i < len; i++) {
    const point = pointsCollection.get(i);
    const sat = point.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    // 性能核心：只有以下情况才执行 SGP4 计算：
    // 1. 属于当前帧的处理批次
    // 2. 是被选中的卫星 (必须保证平滑)
    // 3. (可选) 之前在华盛顿附近的卫星可以增加更新频率
    if (i % BATCH_COUNT !== currentBatch && !isSelected) {
      continue; 
    }

    const data = getSatellitePosition(sat, now);
    if (data) {
      const position = new Cesium.Cartesian3(data.x, data.y, data.z);
      point.position = position;
      
      // 飞线空间粗筛：只有在华盛顿经纬度包围盒内的才计算距离
      if (data.lon > -130 && data.lon < -110 && data.lat > 40 && data.lat < 55) {
        gsCartesians.forEach(gsPos => {
          const dist = Cesium.Cartesian3.distance(position, gsPos);
          if (dist < COMM_RANGE) {
            dataLinksCollection.add({
              positions: [position, gsPos],
              width: 1.0,
              material: Cesium.Material.fromType('PolylineGlow', {
                glowPower: 0.05,
                color: Cesium.Color.CYAN.withAlpha(0.4)
              })
            });
          }
        });
      }

      if (isSelected) {
        point.color = Cesium.Color.YELLOW;
        point.pixelSize = 8;
        
        if (beamCollection.length > 0) {
          const beam = beamCollection.get(0);
          const cartographic = Cesium.Cartographic.fromCartesian(position);
          cartographic.height = 0;
          const surfacePosition = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
          beam.positions = [position, surfacePosition];
        }
      } else {
        point.color = Cesium.Color.fromCssColorString('#06b6d4');
        point.pixelSize = 3;
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
          width: 1.5,
          material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.3) })
        });
      }
      beamCollection.add({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
        width: 1.5,
        material: Cesium.Material.fromType('PolylineGlow', { 
          glowPower: 0.1,
          color: Cesium.Color.CYAN.withAlpha(0.8) 
        })
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