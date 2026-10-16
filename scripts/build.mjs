import { mkdir, copyFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = ['index.html', 'style.css', 'game.js', 'world.js', 'driving.js', 'navigation.js', 'fares.js', 'rendering.js', 'RESEARCH.md'];
await mkdir(join(root, 'dist', 'vendor'), { recursive: true });
for (const file of files) await copyFile(join(root, file), join(root, 'dist', file));
await cp(join(root, 'vendor'), join(root, 'dist', 'vendor'), { recursive: true });
await cp(join(root, 'assets'), join(root, 'dist', 'assets'), { recursive: true });
console.log('Static game ready in dist/ (no external JavaScript dependencies).');
