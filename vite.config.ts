import { defineConfig } from 'vite';

export default defineConfig({
    worker: {
        format: 'es',
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
