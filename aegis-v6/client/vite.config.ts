/**
 * File: vite.config.ts
 *
 * What this file does:
 * Vite build configuration for the Aegis client. Sets up:
 * - React HMR plugin with Fast Refresh
 * - Path alias: @/ -> ./src/ for clean imports
 * - Dev proxy: /api, /uploads, /socket.io all forwarded to localhost:3001
 *   so the client can run on :5173 while the server runs on :3001
 * - Code splitting: large dependencies (react, leaflet, map-3d, charts,
 *   socket.io, i18n, icons, sentry, tanstack) split into named chunks
 *   so the initial page load only downloads the smallest possible bundle
 *
 * How it connects:
 * - Consumed by `npm run dev` (local) and `npm run build` (production)
 * - Production builds served by nginx (client/Dockerfile + nginx.conf)
 * - Environment variable VITE_API_URL overrides proxy target in production
 * - Learn more: https://vitejs.dev/config/
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  //Strip console.log/debug/info from production builds via dead-code elimination.
  //console.error and console.warn are preserved for runtime diagnostics.
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['debugger'] : [],
    pure: process.env.NODE_ENV === 'production'
      ? ['console.log', 'console.debug', 'console.info']
      : [],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    host: true, // expose on LAN so phones on same WiFi can reach 192.168.x.x:5173
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: {
    //Split large bundles so initial load is faster
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          //React core (must come first to avoid circular deps)
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
            return 'react'
          }
          if (id.includes('node_modules/react-router')) {
            return 'react-router'
          }
          //Map libraries (heavy) - exclude maplibre to avoid circular deps
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
            return 'leaflet'
          }
          //3D/deck.gl libraries
          if (id.includes('node_modules/three') || id.includes('node_modules/deck.gl') || id.includes('node_modules/@deck.gl') || id.includes('node_modules/@luma.gl') || id.includes('node_modules/@loaders.gl') || id.includes('node_modules/maplibre') || id.includes('node_modules/@mapbox')) {
            return 'map-3d'
          }
          //Charts & visualization
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) {
            return 'charts'
          }
          //Socket & real-time
          if (id.includes('node_modules/socket.io')) {
            return 'socket'
          }
          //i18n
          if (id.includes('node_modules/i18next') || id.includes('node_modules/react-i18next')) {
            return 'i18n'
          }
          //UI icons
          if (id.includes('node_modules/lucide-react')) {
            return 'icons'
          }
          //Sentry
          if (id.includes('node_modules/@sentry')) {
            return 'sentry'
          }
          //TanStack Query
          if (id.includes('node_modules/@tanstack')) {
            return 'tanstack'
          }
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
