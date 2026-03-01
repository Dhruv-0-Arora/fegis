import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  if (mode === 'content') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/index.ts'),
          name: 'PiiShieldContent',
          formats: ['iife'],
          fileName: () => 'content.js',
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }
  }

  if (mode === 'background') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/background/index.ts'),
          name: 'PiiShieldBackground',
          formats: ['iife'],
          fileName: () => 'background.js',
        },
        rollupOptions: {
          output: {
            inlineDynamicImports: true,
          },
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }
  }

  if (mode === 'interceptor') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/content/fetch-interceptor.ts'),
          name: 'PiiShieldInterceptor',
          formats: ['iife'],
          fileName: () => 'fetch-interceptor.js',
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }
  }

  if (mode === 'offscreen') {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/offscreen/index.ts'),
          name: 'PiiShieldOffscreen',
          formats: ['iife'],
          fileName: () => 'offscreen.js',
        },
      },
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }
  }

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
  }
})
