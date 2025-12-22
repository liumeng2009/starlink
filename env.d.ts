// Fixed: "Cannot find type definition file for 'vite/client'" by removing the reference
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module '*?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}

declare module 'cesium-mvt-imagery-provider';

