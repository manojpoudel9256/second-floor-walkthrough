import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DoorDef } from './types';

export interface House {
  root: THREE.Group;
  hinges: Map<string, THREE.Object3D>;
  bases: Map<string, THREE.Object3D>;
  doorMeshes: THREE.Mesh[];
  staticMeshes: THREE.Mesh[];
  ceilingMeshes: THREE.Mesh[];
  fans: { node: THREE.Object3D; rps: number }[];
  stats: { sourceMeshes: number; mergedMeshes: number; triangles: number };
}

export async function loadJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (${r.status})`);
  return (await r.json()) as T;
}

const isCeiling = (name: string) => /^(CEILING__|SLAB__CEILING|COVE__)/.test(name);

/** Load the GLB, verify required door nodes, and merge static meshes by material (fewer draw calls). */
export async function loadHouse(url: string, doors: DoorDef[], expectedBytes: number,
                                onProgress: (f: number | null) => void, merge = true): Promise<House> {
  const loader = new GLTFLoader();
  const gltf = await new Promise<any>((resolve, reject) =>
    loader.load(url, resolve, (e) => {
      const total = e.lengthComputable && e.total ? e.total : expectedBytes;
      onProgress(total ? Math.min(1, e.loaded / total) : null);
    }, (err) => reject(new Error(`Model failed to load: ${(err as Error)?.message ?? err}`))));
  const root: THREE.Group = gltf.scene;
  root.updateMatrixWorld(true);

  const hinges = new Map<string, THREE.Object3D>();
  const bases = new Map<string, THREE.Object3D>();
  const missing: string[] = [];
  for (const d of doors) {
    const h = root.getObjectByName(d.hingeNode), b = root.getObjectByName(d.baseNode);
    if (!h || !b || !root.getObjectByName(d.leafNode)) missing.push(d.id);
    else { hinges.set(d.id, h); bases.set(d.id, b); }
  }
  if (missing.length) throw new Error(`Model is missing door nodes: ${missing.join(', ')}`);

  const doorMeshes: THREE.Mesh[] = [];
  const doorOf = new Map<THREE.Object3D, string>();
  for (const [id, h] of hinges) h.traverse((o) => doorOf.set(o, id));
  // spinning fan rotors (empties tagged sf_role=fan_rotor): keep their meshes out of the static merge
  const fans: { node: THREE.Object3D; rps: number }[] = [];
  const moving = new Set<THREE.Object3D>();
  root.traverse((o) => { if (o.userData?.sf_role === 'fan_rotor') { fans.push({ node: o, rps: +(o.userData.sf_spin_rps ?? 1.2) }); o.traverse((c) => moving.add(c)); } });

  const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; ceiling: boolean; shadow: boolean }>();
  const toRemove: THREE.Mesh[] = [];
  let sourceMeshes = 0, triangles = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    sourceMeshes++;
    const g = m.geometry as THREE.BufferGeometry;
    triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const mat = m.material as THREE.MeshStandardMaterial;
    tuneMaterial(mat);
    const isGround = /OUTSIDE__GROUND/.test(nodeName(m));
    m.castShadow = !isGround && !mat.transparent;
    m.receiveShadow = true;
    const did = doorOf.get(m);
    if (did) { m.userData.doorId = did; doorMeshes.push(m); return; }
    if (moving.has(m)) { m.castShadow = false; return; }
    if (!merge) return;
    const ceiling = isCeiling(nodeName(m));
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${mat.uuid}|${attrs}|${!!g.index}|${ceiling}|${isGround}`;
    const geo = g.clone().applyMatrix4(m.matrixWorld);
    if (!groups.has(key)) groups.set(key, { mat, geos: [], ceiling, shadow: m.castShadow });
    groups.get(key)!.geos.push(geo);
    toRemove.push(m);
  });

  const staticMeshes: THREE.Mesh[] = [];
  const ceilingMeshes: THREE.Mesh[] = [];
  if (merge) {
    for (const m of toRemove) m.parent?.remove(m);
    const merged = new THREE.Group(); merged.name = 'MERGED_STATIC';
    for (const [key, grp] of groups) {
      const geo = grp.geos.length === 1 ? grp.geos[0] : mergeGeometries(grp.geos, false);
      if (!geo) throw new Error(`merge failed for ${key}`);
      const mesh = new THREE.Mesh(geo, grp.mat);
      mesh.castShadow = grp.shadow; mesh.receiveShadow = true;
      mesh.name = `MERGED__${(grp.mat.name || 'mat')}${grp.ceiling ? '__CEIL' : ''}`;
      merged.add(mesh); staticMeshes.push(mesh);
      if (grp.ceiling) ceilingMeshes.push(mesh);
    }
    root.add(merged);
  } else {
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.doorId && !moving.has(m)) { staticMeshes.push(m); if (isCeiling(nodeName(m))) ceilingMeshes.push(m); } });
  }
  return { root, hinges, bases, doorMeshes, staticMeshes, ceilingMeshes, fans,
           stats: { sourceMeshes, mergedMeshes: staticMeshes.length + doorMeshes.length, triangles: Math.round(triangles) } };
}

function nodeName(o: THREE.Object3D): string {
  let n: THREE.Object3D | null = o;
  const names: string[] = [];
  while (n) { if (n.name) names.push(n.name); n = n.parent; }
  return names.join('/');
}

function tuneMaterial(mat: THREE.MeshStandardMaterial) {
  if (!mat || mat.userData.__tuned) return;
  mat.userData.__tuned = true;
  const n = mat.name || '';
  if (n.startsWith('M_Glass')) { mat.transparent = true; mat.depthWrite = false; mat.roughness = 0.05; mat.metalness = 0; mat.opacity = Math.min(mat.opacity, 0.22); }
  if (n.startsWith('M_Mirror')) { mat.metalness = 1; mat.roughness = 0.03; mat.envMapIntensity = 1.4; }
  if (n.startsWith('M_Floor_Marble')) { mat.envMapIntensity = 0.9; }
  // Jhoomer crystals (and any other KHR_materials_transmission glass): real refraction needs a second full-scene
  // render every frame and renders BLACK or flickers on many phone GPUs. Use bright reflective transparent glass instead.
  const phys = mat as THREE.MeshPhysicalMaterial;
  if (phys.isMeshPhysicalMaterial && phys.transmission > 0) {
    phys.transmission = 0; phys.thickness = 0;
    phys.transparent = true; phys.opacity = 0.42; phys.depthWrite = false;
    phys.color.set(0xf4f8ff); phys.metalness = 0.0; phys.roughness = 0.02;
    phys.envMapIntensity = 2.2; phys.specularIntensity = 1.0; phys.clearcoat = 1.0; phys.clearcoatRoughness = 0.02;
    phys.emissive.set(0x3a2a18); phys.emissiveIntensity = 0.6;               // warm inner glow from the lamps
    phys.side = THREE.DoubleSide;
  }
  if (n.startsWith('M_Cove_LED') || n.startsWith('M_Downlight') || n.startsWith('M_Bath_Light')) mat.toneMapped = true;
}
