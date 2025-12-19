
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
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

// 使用 16x16 的高密度发光圆点 PNG，比 SVG 渲染开销更低
const SATELLITE_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABX0lEQVQ4y52TzStEURiHn/fOnSgzY6IsmIWFshA7Y6GkhmIhK8ofYGFp9idYyVpYmY2FlZKVpZKVmY0pS8mS8id478W5Y86979yZon6773nPeXqep6OIsizLpAnYAs7LsjzLshwwD7wAnX/G7ALXQB6YAtKAnmXZTid8A66Asf8K6IuK9ALNfwX0VpXpB7p/D9AA3I3C/fH6H6X9E6AbGAf6Y0ArMAZUA0vAFXAJ3AD7wCHwAnS0AnvAGS6fS6AWGIn9i7S3A6m6WAtYArZiaX9F2vPAO7CPV1W6GpgAdpE2A/S0A7vAAnAA9ALN8XsW6AnAm0hbA3ba6HqA89i8S3uXf9Iu7U369Xre9B05pC6f0v8G5IHGKLALXOKfLp/S/uV380uS0hA6v0O7y1XG83LofAOdI8A87l96oEuk9Mv67GId6G7GfG36XpB96vIBD0idrI9L5XMAAAAASUVORK5CYII=';

let viewer: any = null;
let billboardsCollection: any = null;
let orbitPathPrimitive: any = null;
let beamPrimitive: any = null;
let isReady = false;

// 预分配对象以减少 GC
let scratchCartesian: any = null;
let frameCount = 0;
let lastFpsUpdateTime = performance.now();

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
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  // 渲染质量与性能优化
  viewer.scene.logarithmicDepthBuffer = true; // 修复高空深度冲突导致的蜂窝伪影
  viewer.scene.globe.depthTestAgainstTerrain = false; // 关闭地形深度测试，防止地表网格纹理错误
  viewer.scene.highDynamicRange = false;
  viewer.scene.postProcessStages.fxaa.enabled = false; // 如果追求极致 FPS，可关闭抗锯齿
  
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
      image: SATELLITE_IMAGE, // 使用 PNG
      scale: 0.8, // PNG 基础尺寸小，适当调大缩放
      color: Cesium.Color.WHITE.withAlpha(0.9), // 图片自带颜色时用白色叠加，或者用 Tint
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

    const data = getSatellitePosition(sat, now);
    if (data) {
      // 核心：同步更新坐标
      scratchCartesian.x = data.x;
      scratchCartesian.y = data.y;
      scratchCartesian.z = data.z;
      
      // 使用 clone 确保触发 Cesium 的内部 Setter 以更新渲染
      bb.position = Cesium.Cartesian3.clone(scratchCartesian, bb.position);
      
      if (isSelected) {
        bb.color = Cesium.Color.YELLOW;
        bb.scale = 1.2;
        
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
        // 恢复默认颜色和缩放
        bb.color = Cesium.Color.WHITE.withAlpha(0.9);
        bb.scale = 0.8;
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
