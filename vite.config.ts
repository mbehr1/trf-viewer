import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import * as child from "child_process";

const commitHash = child.execSync("git rev-parse --short HEAD").toString();

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [
    react(),
    nodePolyfills({
      exclude: [],
      protocolImports: true
    })
  ],
  base: '/trf-viewer/'
})
