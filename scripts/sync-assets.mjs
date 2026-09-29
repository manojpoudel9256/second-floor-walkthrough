// Copies ONLY the optimized runtime exports into public/assets. Construction photos/video,
// .blend sources and reports are never copied (privacy + bundle size).
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'project', 'exports');
const dst = join(here, '..', 'public', 'assets');
const ALLOW = ['second_floor.glb', 'rooms.json', 'doors.json', 'colliders.json', 'lights.json', 'scene-metadata.json'];
mkdirSync(dst, { recursive: true });
// Standalone checkout (e.g. GitHub Actions): no project/exports next to web/, use the committed public/assets.
if (!existsSync(src)) {
  const missing = ALLOW.filter((f) => !existsSync(join(dst, f)));
  if (missing.length) { console.error(`missing runtime files: ${missing.join(', ')}`); process.exit(1); }
  console.log('project/exports not found; using committed public/assets');
  process.exit(0);
}
for (const f of readdirSync(dst)) if (!ALLOW.includes(f)) rmSync(join(dst, f), { recursive: true, force: true });
let total = 0;
for (const f of ALLOW) {
  const p = join(src, f);
  if (!existsSync(p)) { console.error(`missing export: ${p}`); process.exit(1); }
  copyFileSync(p, join(dst, f));
  total += statSync(p).size;
}
console.log(`synced ${ALLOW.length} runtime files (${(total / 1e6).toFixed(2)} MB) from project/exports`);
