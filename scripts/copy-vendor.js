// Copia la build de navegador de SheetJS a public/vendor (se ejecuta en postinstall).
import { mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dest = path.join(root, 'public', 'vendor');
mkdirSync(dest, { recursive: true });
copyFileSync(
  path.join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'),
  path.join(dest, 'xlsx.full.min.js')
);
