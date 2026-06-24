import { defineConfig } from 'vite';

export default defineConfig({
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
