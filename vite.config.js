import { defineConfig } from 'vite'

export default defineConfig({
  base: '/dam-busters/',
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        map: 'map/map.html'
      }
    }
  }
})