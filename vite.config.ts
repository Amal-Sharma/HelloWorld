import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples/')) return 'three-controls'
          if (id.includes('node_modules/three/src/renderers/') || id.includes('node_modules/three/build/three.module.js'))
            return 'three-renderer'
          if (id.includes('node_modules/three/')) return 'three-core'
          if (id.includes('node_modules/astronom')) return 'astronomy'
        },
      },
    },
  },
})
