<script setup lang="ts">
import { ref, onMounted } from 'vue';
import CesiumViewer from './components/CesiumViewer.vue';
import Overlay from './components/Overlay.vue';
import TimelineControl from './components/TimelineControl.vue';
import { fetchStarlinkTLEs } from './services/tleService';
import { initializeSatellites } from './services/orbitService';
import { SatelliteInfo } from './types';

const satellites = ref<SatelliteInfo[]>([]);
const selectedSatId = ref<string | null>(null);
const isLoading = ref(true);

// App State
const currentTime = ref(new Date());
const playbackSpeed = ref(1);
const isPaused = ref(false);
const manualSeekTime = ref<Date | null>(null);
const sceneMode = ref<'3D' | '2D'>('3D');
const layerMode = ref<'MVT' | 'ArcGIS'>('MVT');
const currentFps = ref(0);

onMounted(async () => {
  try {
    const tles = await fetchStarlinkTLEs();
    satellites.value = initializeSatellites(tles);
  } catch (error) {
    console.error("Failed to load satellite data", error);
  } finally {
    isLoading.value = false;
  }
});

const handleSatelliteClick = (satId: string | null) => {
  selectedSatId.value = satId;
};

const handleTick = (date: Date) => {
  currentTime.value = date;
};

const handleSeek = (date: Date) => {
  manualSeekTime.value = date;
  currentTime.value = date;
};

const getSelectedSatellite = (): SatelliteInfo | null => {
  if (!selectedSatId.value) return null;
  return satellites.value.find(s => s.id === selectedSatId.value) || null;
};
</script>

<template>
  <div class="relative w-screen h-screen bg-black">
    <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-slate-900 text-cyan-400 z-50">
      <div class="flex flex-col items-center gap-4">
        <svg class="animate-spin h-10 w-10 text-cyan-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-xl font-light tracking-widest uppercase">Initializing Starlink Constellation...</span>
      </div>
    </div>
    
    <template v-else>
      <CesiumViewer 
        :satellites="satellites" 
        :selectedSatelliteId="selectedSatId"
        :playbackSpeed="playbackSpeed"
        :isPaused="isPaused"
        :manualTime="manualSeekTime"
        :sceneMode="sceneMode"
        :layerMode="layerMode"
        @satelliteClick="handleSatelliteClick"
        @tick="handleTick"
        @update:fps="currentFps = $event"
      />
      
      <Overlay 
        :totalSatellites="satellites.length" 
        :selectedSatellite="getSelectedSatellite()"
        :currentTime="currentTime"
        :fps="currentFps"
        :sceneMode="sceneMode"
        :layerMode="layerMode"
        @update:sceneMode="sceneMode = $event"
        @update:layerMode="layerMode = $event"
        @closeSelection="selectedSatId = null"
      />

      <div class="absolute bottom-8 left-0 right-0 z-20 px-4">
        <TimelineControl 
          :currentTime="currentTime"
          :playbackSpeed="playbackSpeed"
          :isPaused="isPaused"
          @update:isPaused="isPaused = $event"
          @update:playbackSpeed="playbackSpeed = $event"
          @seek="handleSeek"
        />
      </div>
    </template>
  </div>
</template>