import { copyFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const iife = join(dist, 'widget.iife.js');

if (!existsSync(iife)) {
  console.error('postbuild: dist/widget.iife.js missing — vite build failed?');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Stable CDN URL (short cache) and version-pinned URL (immutable cache)
copyFileSync(iife, join(dist, 'widget.cdn.js'));
copyFileSync(iife, join(dist, `widget@${version}.js`));

console.log(`postbuild: widget.cdn.js + widget@${version}.js ready`);
