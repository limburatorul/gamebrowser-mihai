import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    },
    build: {
      lib: {
        entry: {
          index: resolve('electron/main/index.ts'),
          'launcher-helper': resolve('electron/main/launcher-helper.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('shared')
      }
    },
    build: {
      lib: {
        entry: resolve('electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@renderer': resolve('src'),
        '@shared': resolve('shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve('index.html')
      }
    },
    plugins: [react()]
  }
})
