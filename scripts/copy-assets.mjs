import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function copyDir(from, to) {
  const source = resolve(root, from);
  if (!existsSync(source)) {
    console.warn(`[copy-assets] skipped (missing): ${from}`);
    return;
  }
  const target = resolve(root, to);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`[copy-assets] ${from} -> ${to}`);
}

copyDir('src/database/migrations', 'dist/database/migrations');
