import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
    define: {
        __WIDGET_VERSION__: JSON.stringify(pkg.version),
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
