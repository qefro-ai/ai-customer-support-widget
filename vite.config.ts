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
            formats: ['iife', 'es', 'umd'],
            fileName: (format) => {
                if (format === 'iife') return 'widget.iife.js';
                if (format === 'es') return 'widget.js';
                return 'widget.umd.cjs';
            },
        },
        rollupOptions: {
            output: {
                extend: true,
            },
        },
        minify: 'esbuild',
    },
});
