import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri v2 dev server contract (from the official template):
//  - port 1420, strictPort so failure is loud rather than swallowed by a port shift,
//  - HMR uses 1421 over the dev host (LAN/mobile when TAURI_DEV_HOST is set),
//  - we ignore src-tauri changes here; tauri-cli watches Rust separately.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
