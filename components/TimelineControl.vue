<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  currentTime: Date;
  isPaused: boolean;
  playbackSpeed: number;
}>();

const emit = defineEmits<{
  (e: 'update:isPaused', value: boolean): void;
  (e: 'update:playbackSpeed', value: number): void;
  (e: 'seek', date: Date): void;
}>();

const formatTime = (date: Date) => {
  return date.toISOString().split('T')[1].split('.')[0];
};

const formatDate = (date: Date) => {
  return date.toISOString().split('T')[0];
};

// Calculate slider value (seconds since start of day)
const sliderValue = computed({
  get: () => {
    const d = props.currentTime;
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  },
  set: (val: number) => {
    // Construct new date based on slider seconds
    const newDate = new Date(props.currentTime);
    newDate.setHours(0, 0, 0, 0); // Reset to midnight
    newDate.setSeconds(val);
    emit('seek', newDate);
  }
});

const speeds = [1, 10, 60, 120, 600];

const togglePause = () => {
  emit('update:isPaused', !props.isPaused);
};

const setSpeed = (speed: number) => {
  emit('update:playbackSpeed', speed);
};
</script>

<template>
  <div class="pointer-events-auto bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl text-white px-6 py-4 flex flex-col gap-3 w-full max-w-3xl mx-auto">
    
    <!-- Top Row: Controls & Time Display -->
    <div class="flex items-center justify-between">
      
      <!-- Playback Controls -->
      <div class="flex items-center gap-4">
        <button 
          @click="togglePause"
          class="w-10 h-10 rounded-full bg-cyan-600 hover:bg-cyan-500 flex items-center justify-center transition-colors shadow-lg shadow-cyan-900/20"
        >
          <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <div class="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button 
            v-for="s in speeds" 
            :key="s"
            @click="setSpeed(s)"
            class="px-3 py-1 text-xs font-mono rounded-md transition-all duration-200"
            :class="playbackSpeed === s ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-slate-700'"
          >
            {{ s }}x
          </button>
        </div>
      </div>

      <!-- Clock Display -->
      <div class="text-right">
        <div class="text-2xl font-mono font-bold tracking-wider text-cyan-50">
          {{ formatTime(currentTime) }}
        </div>
        <div class="text-xs text-slate-400 font-mono">
          {{ formatDate(currentTime) }} UTC
        </div>
      </div>
    </div>

    <!-- Bottom Row: Scrubber -->
    <div class="flex items-center gap-3">
      <span class="text-xs text-slate-500 font-mono">00:00</span>
      <input 
        type="range" 
        min="0" 
        max="86400" 
        v-model.number="sliderValue"
        class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
      />
      <span class="text-xs text-slate-500 font-mono">23:59</span>
    </div>

  </div>
</template>

<style scoped>
/* Custom Range Slider Styling for Webkit */
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 14px;
  width: 14px;
  border-radius: 50%;
  background: #22d3ee;
  cursor: pointer;
  margin-top: -3px; /* You need to specify a margin in Chrome, but in Firefox and IE it is automatic */
  box-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
}
input[type=range]::-webkit-slider-runnable-track {
  width: 100%;
  height: 8px;
  cursor: pointer;
  background: #334155;
  border-radius: 4px;
}
</style>