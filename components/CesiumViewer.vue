<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { SatelliteInfo } from '../types';
import { getSatellitePosition, getOrbitPathECI, getOrbitPathECF, getSatellitePositionAndVelocity } from '../services/orbitService';

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
let billboardCollection: any = null;
let orbitPathCollection: any = null;
let activeOrbitPolyline: any = null;
let cachedOrbitECI: any[] = []; // 缓存 ECI 轨道点
// let beamCollection: any = null;
let groundStationsCollection: any = null;
let dataLinksCollection: any = null;
let isReady = false;
let satelliteImage: any = null; // 缓存生成的卫星图片

// 卫星运动状态缓存 (Typed Arrays for performance)
let satPositionsX: Float32Array;
let satPositionsY: Float32Array;
let satPositionsZ: Float32Array;
let satVelocitiesX: Float32Array;
let satVelocitiesY: Float32Array;
let satVelocitiesZ: Float32Array;
let satUpdateTimes: Float64Array;

// 性能优化控制变量
let frameCount = 0;
let lastFpsUpdateTime = performance.now();
let updateTicket = 0; // 用于分帧更新的计数器
const BATCH_COUNT = 60; // 调整为 60 帧 (约1秒) 更新一次 SGP4，平衡精度与性能
const INTERPOLATION_FREQ = 2; // 恢复每帧更新插值，消除 30fps 的卡顿感

// 预分配临时对象，避免 GC
let scratchCartesian: any = null;

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

  scratchCartesian = new Cesium.Cartesian3();
  // 使用 public 目录下的图片
  satelliteImage = 'satellite.png';

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
    requestRenderMode: true, // 显式开启按需渲染
    maximumRenderTimeChange: Infinity,
    contextOptions: {
      webgl: {
        powerPreference: "high-performance", // 强制使用独显
        alpha: false, // 关闭 canvas 透明通道，减少合成开销
        antialias: false, // 关闭原生抗锯齿
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
      }
    },
    orderIndependentTranslucency: false, // 禁用 OIT (透明度排序)，大幅提升透明物体渲染性能
    imageryProvider: new Cesium.ArcGisMapServerImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    }),
  });

  // --- 核心性能优化配置 (GPU & 渲染管线) ---

  // 1. 分辨率缩放：在视网膜屏幕上强制使用 1.0 或更低 (0.8-0.9) 以大幅降低片元着色器压力
  // 进一步降低分辨率以提升 FPS
  viewer.resolutionScale = window.devicePixelRatio > 1 ? 0.7 : 0.7;

  // 2. 关闭高动态范围渲染 (HDR)：减少显存带宽占用
  viewer.scene.highDynamicRange = false;

  // 3. 关闭抗锯齿 (FXAA)：虽然有锯齿，但能显著提速
  viewer.scene.postProcessStages.fxaa.enabled = false;

  // 4. 关闭大气层和天空盒效果：这些是极其昂贵的透明度混合操作
  viewer.scene.skyAtmosphere.show = false;
  viewer.scene.skyBox.show = false; // 如果背景是纯黑，可以关掉天空盒
  viewer.scene.sun.show = false;    // 关闭太阳渲染
  viewer.scene.moon.show = false;   // 关闭月亮渲染

  // 5. 简化地球渲染
  viewer.scene.globe.enableLighting = false; // 关闭动态光照计算
  viewer.scene.globe.showGroundAtmosphere = false; // 关闭地面大气效果
  viewer.scene.fog.enabled = false; // 关闭雾效
  
  // 6. 深度检测优化
  viewer.scene.globe.depthTestAgainstTerrain = false; // 防止Z-fighting并减少深度测试开销
  viewer.scene.logarithmicDepthBuffer = false; // 如果没有严重的Z-fighting，关闭它能省一点性能

  // 7. 背景色设为纯黑，避免不必要的清除操作
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  
  // 8. 拾取优化：禁用半透明拾取，减少离屏渲染
  viewer.scene.pickTranslucency = false;

  // -----------------------------------------

  viewer.clock.multiplier = props.playbackSpeed;
  viewer.clock.currentTime = Cesium.JulianDate.fromDate(new Date());

  billboardCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection());
  orbitPathCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  // beamCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  dataLinksCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection());
  // groundStationsCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  
  // initGroundStations();

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
    
    // 强制渲染循环：在播放时显式请求渲染，防止 requestRenderMode 导致画面静止
    if (!props.isPaused && viewer) {
      viewer.scene.requestRender();
    }

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
  billboardCollection.removeAll();
  
  // 初始化 Typed Arrays
  const count = props.satellites.length;
  satPositionsX = new Float32Array(count);
  satPositionsY = new Float32Array(count);
  satPositionsZ = new Float32Array(count);
  satVelocitiesX = new Float32Array(count);
  satVelocitiesY = new Float32Array(count);
  satVelocitiesZ = new Float32Array(count);
  satUpdateTimes = new Float64Array(count);

  props.satellites.forEach((sat, index) => {
    billboardCollection.add({
      position: Cesium.Cartesian3.ZERO,
      image: satelliteImage,
      scale: 0.1, // 图片可能比较大，默认缩小到 0.1
      color: Cesium.Color.WHITE, // 使用图片原色，或者根据需要染色
      id: sat,
    });
    // 初始化时间为 0，确保第一次 update 会触发
    satUpdateTimes[index] = 0;
  });
};

const onTick = (clock: any) => {
  if (!billboardCollection || !isReady) return;
  
  const Cesium = window.Cesium;
  const now = Cesium.JulianDate.toDate(clock.currentTime);
  emit('tick', now);

  // 飞线更新逻辑：每帧清空，重新按需生成
  dataLinksCollection.removeAll();
  
  const len = billboardCollection.length;
  const gsCartesians = groundStations.map(gs => Cesium.Cartesian3.fromDegrees(gs.lon, gs.lat));
  
  // 分帧逻辑：计算当前帧需要处理的卫星索引范围
  const currentBatch = updateTicket % BATCH_COUNT;
  updateTicket++;
  const nowTime = now.getTime();

  // 性能优化：获取相机位置用于视锥剔除 (简单的地平线剔除)
  const cameraPos = viewer.camera.position;
  
  for (let i = 0; i < len; i++) {
    const billboard = billboardCollection.get(i);
    const sat = billboard.id as SatelliteInfo; 
    const isSelected = props.selectedSatelliteId && sat.id === props.selectedSatelliteId;

    // 性能核心：只有以下情况才执行 SGP4 计算：
    // 1. 属于当前帧的处理批次
    // 2. 是被选中的卫星 (必须保证平滑)
    const shouldSGP4Update = (i % BATCH_COUNT === currentBatch) || isSelected;
    
    // 插值更新频率控制：非选中卫星每 INTERPOLATION_FREQ 帧更新一次
    // 使用 i + updateTicket 错峰更新，避免所有卫星在同一帧更新
    const shouldInterpUpdate = isSelected || ((i + updateTicket) % INTERPOLATION_FREQ === 0);

    // 如果既不需要 SGP4 更新，也不需要插值更新，直接跳过
    if (!shouldSGP4Update && !shouldInterpUpdate) {
      continue;
    }

    let pos: { x: number, y: number, z: number } | null = null;

    if (shouldSGP4Update) {
      const data = getSatellitePositionAndVelocity(sat, now);
      if (data) {
        // 更新 Typed Arrays
        satPositionsX[i] = data.x;
        satPositionsY[i] = data.y;
        satPositionsZ[i] = data.z;
        satVelocitiesX[i] = data.vx;
        satVelocitiesY[i] = data.vy;
        satVelocitiesZ[i] = data.vz;
        satUpdateTimes[i] = nowTime;

        pos = data;

        // 更新样式 (仅在 SGP4 更新时处理，减少开销)
        if (isSelected) {
          billboard.color = Cesium.Color.YELLOW; // 选中时染成黄色
          billboard.scale = 0.3; // 选中放大 (0.1 -> 0.3)
        } else {
          billboard.color = Cesium.Color.WHITE; // 未选中显示原色 (或白色)
          billboard.scale = 0.1; // 默认大小
        }
      }
    } else if (shouldInterpUpdate) {
      // 使用缓存的速度进行外推 (Dead Reckoning)
      // 检查是否有缓存数据 (时间不为0)
      if (satUpdateTimes[i] > 0) {
        const lastTime = satUpdateTimes[i];
        const dt = (nowTime - lastTime) / 1000; // seconds
        
        const cx = satPositionsX[i];
        const cy = satPositionsY[i];
        const cz = satPositionsZ[i];
        const cvx = satVelocitiesX[i];
        const cvy = satVelocitiesY[i];
        const cvz = satVelocitiesZ[i];

        // 线性外推
        let px = cx + cvx * dt;
        let py = cy + cvy * dt;
        let pz = cz + cvz * dt;

        // 关键修正：球面约束 (Spherical Constraint)
        // 线性外推会沿切线飞出，导致高度增加。这里强制将位置拉回到原来的轨道高度。
        // 假设短时间内轨道高度不变 (对于圆轨道近似成立)
        const currentMagSq = px*px + py*py + pz*pz;
        const cachedMagSq = cx*cx + cy*cy + cz*cz;
        
        // 只有当误差明显时才修正 (避免开方开销)
        if (Math.abs(currentMagSq - cachedMagSq) > 1.0) {
           const scale = Math.sqrt(cachedMagSq / currentMagSq);
           px *= scale;
           py *= scale;
           pz *= scale;
        }

        pos = { x: px, y: py, z: pz };
      }
    }

    if (pos) {
      // 零 GC 优化：复用 scratchCartesian 对象
      scratchCartesian.x = pos.x;
      scratchCartesian.y = pos.y;
      scratchCartesian.z = pos.z;
      
      // 视锥剔除/地平线剔除优化：
      // 如果卫星在地球背面，且不是被选中的卫星，则跳过属性更新
      // 简单的点积判断：(SatPos - EarthCenter) dot (CameraPos - EarthCenter)
      // 注意：这里简化为直接用位置向量点积，因为 EarthCenter 是 (0,0,0)
      if (!isSelected) {
         const dot = (scratchCartesian.x * cameraPos.x + 
                      scratchCartesian.y * cameraPos.y + 
                      scratchCartesian.z * cameraPos.z);
         
         // dot < 0 表示卫星在地球背面 (相对于相机)
         // 我们可以直接隐藏它，或者不更新位置
         // 为了性能，我们选择不更新位置，并将其隐藏
         if (dot < 0) {
            if (billboard.show) billboard.show = false;
            continue;
         } else {
            if (!billboard.show) billboard.show = true;
         }
      } else {
         // 选中的卫星始终显示
         if (!billboard.show) billboard.show = true;
      }
      
      billboard.position = scratchCartesian; 
      
      // 飞线空间粗筛：只有在华盛顿经纬度包围盒内的才计算距离
      /*
      if (data.lon > -130 && data.lon < -110 && data.lat > 40 && data.lat < 55) {
        gsCartesians.forEach(gsPos => {
          const dist = Cesium.Cartesian3.distance(scratchCartesian, gsPos);
          if (dist < COMM_RANGE) {
            dataLinksCollection.add({
              positions: [scratchCartesian, gsPos],
              width: 1.0,
              material: Cesium.Material.fromType('PolylineGlow', {
                glowPower: 0.05,
                color: Cesium.Color.CYAN.withAlpha(0.4)
              })
            });
          }
        });
      }
      */

      /*
      if (isSelected && beamCollection.length > 0) {
        const beam = beamCollection.get(0);
        const cartographic = Cesium.Cartographic.fromCartesian(scratchCartesian);
        cartographic.height = 0;
        const surfacePosition = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
        beam.positions = [scratchCartesian, surfacePosition];
      }
      */
    }
  }

  if (activeOrbitPolyline && props.selectedSatelliteId && cachedOrbitECI.length > 0) {
    const pathPoints = getOrbitPathECF(cachedOrbitECI, now);
    activeOrbitPolyline.positions = pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z));
  }
};

watch(() => props.satellites, updateSatellites);
watch(() => props.selectedSatelliteId, () => {
  if (!isReady) return;
  const Cesium = window.Cesium;
  orbitPathCollection.removeAll();
  activeOrbitPolyline = null;
  // beamCollection.removeAll();
  cachedOrbitECI = [];

  if (props.selectedSatelliteId) {
    const sat = props.satellites.find(s => s.id === props.selectedSatelliteId);
    if (sat) {
      const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
      // 仅计算一次昂贵的 SGP4 传播
      cachedOrbitECI = getOrbitPathECI(sat, now);
      const pathPoints = getOrbitPathECF(cachedOrbitECI, now);
      
      if (pathPoints.length > 1) {
        activeOrbitPolyline = orbitPathCollection.add({
          positions: pathPoints.map(p => new Cesium.Cartesian3(p.x, p.y, p.z)),
          width: 1.5,
          material: Cesium.Material.fromType('Color', { color: Cesium.Color.YELLOW.withAlpha(0.3) })
        });
      }
      /*
      beamCollection.add({
        positions: [Cesium.Cartesian3.ZERO, Cesium.Cartesian3.ZERO],
        width: 1.5,
        material: Cesium.Material.fromType('PolylineGlow', { 
          glowPower: 0.1,
          color: Cesium.Color.CYAN.withAlpha(0.8) 
        })
      });
      */
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