<script setup lang="ts">
import { ref, watch } from 'vue';
import { SatelliteInfo } from '../types';
import { getSatellitePosition } from '../services/orbitService';

const props = defineProps<{
  totalSatellites: number;
  selectedSatellite: SatelliteInfo | null;
  currentTime: Date;
  fps: number;
  sceneMode: '3D' | '2D';
  layerMode: 'MVT' | 'ArcGIS';
}>();

const emit = defineEmits<{
  (e: 'closeSelection'): void;
  (e: 'update:sceneMode', mode: '3D' | '2D'): void;
  (e: 'update:layerMode', mode: 'MVT' | 'ArcGIS'): void;
}>();

const liveStats = ref<{lat: number, lon: number, height: number, velocity: number} | null>(null);

watch(() => [props.selectedSatellite, props.currentTime], () => {
  if (props.selectedSatellite && props.currentTime) {
    const pos = getSatellitePosition(props.selectedSatellite, props.currentTime);
    if (pos) {
      liveStats.value = {
        lat: pos.lat,
        lon: pos.lon,
        height: pos.height,
        velocity: pos.velocity
      };
    }
  } else {
    liveStats.value = null;
  }
});
</script>

<template>
  <div class="absolute inset-0 pointer-events-none flex flex-col justify-between p-6">
    
    <!-- Top Row Header & Global Info -->
    <header class="pointer-events-auto flex items-start justify-between">
      <div class="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 p-4 rounded-xl shadow-2xl text-white">
        <h1 class="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          Starlink Live
        </h1>
        <div class="flex items-center gap-2 mt-2 text-sm text-slate-400">
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span>{{ totalSatellites }} active orbits</span>
          <span class="mx-1">|</span>
          <span class="font-mono text-[10px] uppercase text-slate-500">{{ fps }} FPS</span>
        </div>
      </div>

      <!-- Controls Group -->
      <div class="flex gap-2">
        <!-- Layer Switcher -->
        <div class="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 p-1 rounded-lg flex shadow-xl">
          <button 
            @click="emit('update:layerMode', 'MVT')"
            class="px-4 py-2 rounded-md transition-all duration-200 text-xs font-bold uppercase"
            :class="layerMode === 'MVT' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'"
          >
            Local MVT
          </button>
          <button 
            @click="emit('update:layerMode', 'ArcGIS')"
            class="px-4 py-2 rounded-md transition-all duration-200 text-xs font-bold uppercase"
            :class="layerMode === 'ArcGIS' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'"
          >
            ArcGIS
          </button>
        </div>

        <!-- Scene Mode Switcher -->
        <div class="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 p-1 rounded-lg flex shadow-xl">
          <button 
            @click="emit('update:sceneMode', '3D')"
            class="px-4 py-2 rounded-md transition-all duration-200 text-xs font-bold uppercase"
            :class="sceneMode === '3D' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'"
          >
            3D Globe
          </button>
          <button 
            @click="emit('update:sceneMode', '2D')"
            class="px-4 py-2 rounded-md transition-all duration-200 text-xs font-bold uppercase"
            :class="sceneMode === '2D' ? 'bg-cyan-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'"
          >
            2D Map
          </button>
        </div>
      </div>
    </header>

    <!-- Center/Bottom Right Selected Satellite Panel -->
    <div v-if="selectedSatellite" class="pointer-events-auto w-full md:w-80 bg-slate-900/90 backdrop-blur-xl border border-cyan-500/40 rounded-xl p-5 shadow-2xl text-slate-100 mb-28 md:mb-0 transform transition-all animate-in fade-in slide-in-from-right-4 duration-300">
      <div class="flex justify-between items-start mb-4 border-b border-slate-700/50 pb-3">
        <div>
          <h2 class="text-xl font-bold text-cyan-400 tracking-tight">{{ selectedSatellite.name }}</h2>
          <p class="text-[10px] text-slate-500 font-mono tracking-widest mt-0.5">NORAD ID: {{ selectedSatellite.id }}</p>
        </div>
        <button 
          @click="emit('closeSelection')"
          class="text-slate-500 hover:text-white transition-colors p-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>

      <div class="space-y-4">
        <!-- Coordinates Grid -->
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-800/40 border border-slate-700/30 p-3 rounded-lg">
            <p class="text-[10px] text-slate-500 uppercase font-bold tracking-tighter mb-1">Latitude</p>
            <p class="font-mono text-base">{{ liveStats?.lat.toFixed(4) }}°</p>
          </div>
          <div class="bg-slate-800/40 border border-slate-700/30 p-3 rounded-lg">
            <p class="text-[10px] text-slate-500 uppercase font-bold tracking-tighter mb-1">Longitude</p>
            <p class="font-mono text-base">{{ liveStats?.lon.toFixed(4) }}°</p>
          </div>
        </div>

        <!-- Height & Velocity -->
        <div class="flex flex-col gap-2">
          <div class="bg-cyan-950/20 border border-cyan-500/20 p-3 rounded-lg flex items-center justify-between">
            <div>
              <p class="text-[10px] text-cyan-500/70 uppercase font-bold tracking-tighter">Altitude</p>
              <p class="font-mono text-xl text-white">{{ liveStats?.height.toFixed(1) }} <span class="text-xs text-slate-500">km</span></p>
            </div>
            <div class="text-cyan-400">
               <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
               </svg>
            </div>
          </div>

          <div class="bg-blue-950/20 border border-blue-500/20 p-3 rounded-lg flex items-center justify-between">
            <div>
              <p class="text-[10px] text-blue-500/70 uppercase font-bold tracking-tighter">Orbital Velocity</p>
              <p class="font-mono text-xl text-white">{{ liveStats?.velocity.toFixed(2) }} <span class="text-xs text-slate-500">km/s</span></p>
            </div>
             <div class="text-blue-400">
               <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
               </svg>
            </div>
          </div>
        </div>
      </div>
      
      <div class="mt-5 pt-3 border-t border-slate-800 text-[9px] text-slate-500 text-center uppercase tracking-widest">
        Propagating SGP4 State Vectors
      </div>
    </div>
  </div>
</template>