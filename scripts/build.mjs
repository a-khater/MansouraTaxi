import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = ['index.html', 'style.css', 'game.js', 'world.js', 'driving.js', 'navigation.js', 'RESEARCH.md'];
await mkdir(join(root, 'dist', 'vendor'), { recursive: true });
for (const file of files) await copyFile(join(root, file), join(root, 'dist', file));
for (const file of await readdir(join(root, 'vendor'))) await copyFile(join(root, 'vendor', file), join(root, 'dist', 'vendor', file));
console.log('Static game ready in dist/ (no external JavaScript dependencies).');
