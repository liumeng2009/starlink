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
let isReady = false;

// FPS tracking
let lastFrameTime = performance.now();
let frameCount = 0;
let lastFpsUpdateTime = performance.now();

// Initialize Cesium
onMounted(() => {
  if (!containerRef.value) return;

  const Cesium = window.Cesium;
  if (!Cesium) {
    console.error("CesiumJS not loaded.");
    return;
  }

  try {
    Cesium.buildModuleUrl.setBaseUrl("https://unpkg.com/cesium@1.114.0/Build/Cesium/");
  } catch (e) {
    console.warn("Could not set Cesium base URL:", e);
  }

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
    terrainProvider: undefined,
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  viewer.clock.multiplier = props.playbackSpeed;
  viewer.clock.clockRange = Cesium.ClockRange.UNBOUNDED;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());

  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.atmosphereBrightnessShift = 0.1;
  viewer.scene.highDynamicRange = true;
  viewer.scene.skyBox.show = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;

  // Primitive Collections
  pointsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  orbitPathCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: any) => {
    const pickedObject = viewer.scene.pick(movement.position);
    if (Cesium.defined(pickedObject) && pickedObject.id) {
      const sat = pickedObject.id as SatelliteInfo;
      emit('satelliteClick', sat.id);
    } else {
      emit('satelliteClick', null);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  viewer.clock.onTick.addEventListener(onTick);
  
  // Custom loop for FPS calculation to be independent of clock tick (which might be paused)
  const fpsLoop = (now: number) => {
    if (!isReady) return;
    frameCount++;
    if (now - lastFpsUpdateTime > 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdateTime));
      emit('update:fps', fps);
      frameCount = 0;
      lastFpsUpdateTime = now;
    }
    requestAnimationFrame(fpsLoop);
  };
  requestAnimationFrame(fpsLoop);

  isReady = true;
  updateSatellites();
});

onUnmounted(() => {
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
});

const updateSatellites = () => {
  if (!isReady || !props.satellites.length || !pointsCollection) return;
  const Cesium = window.Cesium;
  pointsCollection.removeAll();

  props.satellites.forEach(sat => {
    pointsCollection.add({
      position: Cesium.Cartesian3.ZERO,
      pixelSize: 4,
      color: Cesium.Color.fromCssColorString('#06b6d4'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      id: sat,
    });
  });
};

const updateSelectionVisuals = () => {
  if (!isReady || !orbitPathCollection || !beamCollection) return;
  const Cesium = window.Cesium;
  orbitPathCollection.removeAll();
  beamCollection.removeAll();

  if (props.selectedSatelliteId) {
    const sat = props.satellites.find(s => s.id === props.selectedSatelliteId);
    if (sat && viewer) {
      const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      const pathPoints = getOrbitPath(sat, now);
      
      if (pathPoints.length > 1) {
        orbitPathCollection.add({
          positions: pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z)),
          width: 2,
          material: Cesium.Material.fromType('Color', {
            color: Cesium.Color.YELLOW.withAlpha(0.6)
          })
        });
      }

      // Add Beam (Initial state, position updated in onTick)
      beamCollection.add({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
        width: 3,
        material: Cesium.Material.fromType('PolylineGlow', {
          glowPower: 0.2,
          taperPower: 0.5,
          color: Cesium.Color.CYAN.withAlpha(0.8)
        })
      });
    }
  }
};

const onTick = (clock: any) => {
  if (!pointsCollection) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  const len = pointsCollection.length;
  for (let i = 0; i < len; i++) {
    const point = pointsCollection.get(i);
    const sat = point.id as SatelliteInfo; 
    
    if (sat) {
      const data = getSatellitePosition(sat, now);
      if (data) {
        const position = new Cesium.Cartesian3(data.x, data.y, data.z);
        point.position = position;
        
        if (props.selectedSatelliteId && sat.id === props.selectedSatelliteId) {
          point.color = Cesium.Color.YELLOW;
          point.pixelSize = 12;
          
          // Update Beam position
          if (beamCollection.length > 0) {
            const beam = beamCollection.get(0);
            // Nadir point: project current Cartesian position to the ellipsoid surface
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            cartographic.height = 0;
            const surfacePosition = Cesium.Cartesian3.fromRadians(
              cartographic.longitude,
              cartographic.latitude,
              0
            );
            beam.positions = [position, surfacePosition];
          }
        } else {
          point.color = Cesium.Color.fromCssColorString('#06b6d4');
          point.pixelSize = 4;
        }
      }
    }
  }
};

// Watchers
watch(() => props.satellites, updateSatellites);
watch(() => props.selectedSatelliteId, updateSelectionVisuals);
watch(() => props.playbackSpeed, (speed) => viewer && (viewer.clock.multiplier = speed));
watch(() => props.isPaused, (val) => viewer && (viewer.clock.shouldAnimate = !val));
watch(() => props.manualTime, (newDate) => {
  if (viewer && newDate) {
    viewer.clock.currentTime = window.Cesium.JulianDate.fromDate(newDate);
    updateSelectionVisuals();
  }
});
watch(() => props.sceneMode, (mode) => {
  if (viewer) {
    const Cesium = window.Cesium;
    if (mode === '2D') {
      viewer.scene.morphTo2D(1.0);
    } else {
      viewer.scene.morphTo3D(1.0);
    }
  }
});
</script>

<template>
  <div ref="containerRef" class="w-full h-full"></div>
</template>