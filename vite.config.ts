import { defineConfig } from 'vite';

export default defineConfig({
    // Classic workers required: @litertjs/core loads Wasm via importScripts(),
    // which module workers reject.
    worker: {
        format: 'iife',
    },
    optimizeDeps: {
        exclude: ['@litertjs/core'],
    },
    build: {
        lib: {
            entry: 'src/index.ts',
            name: 'AIWidget',
            fileName: 'widget',
            formats: ['iife'],
        },
        rollupOptions: {
            output: {
                extend: true,
            },
        },
        minify: 'esbuild',
    },
});
