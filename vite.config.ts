import path from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import federation from '@originjs/vite-plugin-federation'
import { xriftDev } from '@xrift/sdk/vite'

const vdoNinjaStorageShim = () => ({
  name: 'xrift-vdo-ninja-storage-shim',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('/node_modules/@vdoninja/sdk/')) return null

    const patchedCode = code.replace(/\blocalStorage\b/g, '__xriftVdoMemoryStorage')
    if (patchedCode === code) return null

    return {
      code: `const __xriftVdoMemoryStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }\n${patchedCode}`,
      map: null,
    }
  },
})

export default defineConfig({
  plugins: [
    react(),
    xriftDev(),
    vdoNinjaStorageShim(),
    dts({ insertTypesEntry: true }),
    federation({
      name: 'xrift_rc_world',
      filename: 'remoteEntry.js',
      exposes: { './World': './src/index.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '*' },
        'react-dom': { singleton: true, requiredVersion: '*' },
        'react-dom/client': { singleton: true },
        'react/jsx-runtime': { singleton: true },
        three: { singleton: true, requiredVersion: '*' },
        'three/addons/loaders/GLTFLoader.js': { singleton: true },
        'three/addons/loaders/DRACOLoader.js': { singleton: true },
        'three/addons/loaders/KTX2Loader.js': { singleton: true },
        '@react-three/fiber': { singleton: true, requiredVersion: '*' },
        '@react-three/rapier': { singleton: true, requiredVersion: '*' },
        '@react-three/drei': { singleton: true, requiredVersion: '*' },
        '@react-three/uikit': { singleton: true, requiredVersion: '*' },
        '@pmndrs/uikit': { singleton: true, requiredVersion: '*' },
        '@xrift/world-components': { singleton: true, requiredVersion: '*' },
      },
    }),
  ],
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    assetsDir: '',
  },
  resolve: {
    alias: { '~': path.resolve(__dirname, './src') },
  },
  define: { global: 'globalThis' },
})
