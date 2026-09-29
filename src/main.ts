import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadHouse, loadJSON, type House } from './loadHouse';
import { Physics, FIXED_DT, type DoorRuntime } from './world';
import { Input } from './input';
import { Lighting } from './lighting';
import { Minimap, roomAt } from './rooms';
import { Debug } from './debug';
import type { ColliderSets, DoorDef, LightDef, RoomsFile, SceneMeta } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  start: $('start'), bar: $('bar'), status: $('status'), enter: $<HTMLButtonElement>('enter'), err: $('err'), errmsg: $('errmsg'),
  retry: $('retry'), paused: $('paused'), resume: $('resume'), hud: $('hud'), room: $('room'), prompt: $('prompt'),
  menu: $('roommenu'), doorbtn: $<HTMLButtonElement>('doorbtn'), light: $('btn-light'), inspect: $('btn-inspect'),
};
const A = './assets/';

async function boot() {
  const canvas = $<HTMLCanvasElement>('view');
  const mobile = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (mobile) document.body.classList.add('is-touch');
  ui.bar.classList.add('indeterminate');
  ui.status.textContent = 'Loading layout data…';
  const [meta, rooms, doorsF, cols, lightsF] = await Promise.all([
    loadJSON<SceneMeta>(A + 'scene-metadata.json'), loadJSON<RoomsFile>(A + 'rooms.json'),
    loadJSON<{ items: DoorDef[] }>(A + 'doors.json'), loadJSON<{ sets: ColliderSets }>(A + 'colliders.json'),
    loadJSON<{ items: LightDef[] }>(A + 'lights.json')]);
  ui.status.textContent = 'Starting physics…';
  await RAPIER.init();                                                      // before any collider is created

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 75 : 70, innerWidth / innerHeight, 0.05, 200);

  ui.status.textContent = 'Loading the house…';
  ui.bar.classList.remove('indeterminate');
  const noMerge = new URLSearchParams(location.search).has('nomerge');
  const house: House = await loadHouse(A + meta.glb.file, doorsF.items, meta.glb.bytes, (f) => {
    if (f === null) ui.bar.classList.add('indeterminate'); else ui.bar.style.width = `${Math.round(f * 100)}%`;
  }, !noMerge);
  scene.add(house.root);
  const lighting = new Lighting(scene, renderer, lightsF.items, rooms.items, mobile);
  const physics = new Physics(cols.sets, meta);
  for (const d of doorsF.items) physics.addDoor(d, house.hinges.get(d.id)!, house.bases.get(d.id)!);
  const spawn = rooms.spawn;
  physics.setSpawn(spawn.position);
  camera.rotation.set(0, spawn.yawRad, 0, 'YXZ');
  const input = new Input(camera, canvas, $('lookzone'), $('stick'));
  const minimap = new Minimap($<HTMLCanvasElement>('minimap'), cols.sets, rooms.items);
  const debug = new Debug(scene, cols.sets);
  const eyeOffset = meta.player.eye_m - (physics.halfHeight + physics.radius);
  const speed = meta.player.walk_m_s;

  // ---------------------------------------------------------------- state + UI wiring
  let mode: 'walk' | 'inspect' = 'walk';
  let orbit: OrbitControls | null = null;
  let started = false;
  const savedQuat = new THREE.Quaternion();
  const setPlaying = (on: boolean) => { input.enabled = on && mode === 'walk'; ui.paused.hidden = on || !started || mode === 'inspect'; };
  input.plc.addEventListener('lock', () => setPlaying(true));
  input.plc.addEventListener('unlock', () => { if (!mobile) setPlaying(false); });
  const play = () => { if (mobile) setPlaying(true); else input.plc.lock(); };

  ui.enter.disabled = false;
  ui.enter.textContent = 'Enter home';
  ui.status.textContent = `Ready · ${(meta.glb.bytes / 1e6).toFixed(1)} MB · layout revision ${meta.revision} (provisional)`;
  ui.bar.style.width = '100%';
  ui.enter.onclick = () => { started = true; ui.start.hidden = true; ui.hud.hidden = false; play(); };
  ui.resume.onclick = play;

  const reset = () => { physics.setSpawn(spawn.position); camera.rotation.set(0, spawn.yawRad, 0, 'YXZ'); };
  const jump = (id: string) => {
    const r = rooms.items.find((x) => x.id === id);
    if (r?.jumpPoint && r.jumpVerified) physics.setSpawn(r.jumpPoint);
    ui.menu.hidden = true; if (mode === 'inspect') toggleInspect(); play();
  };
  for (const r of rooms.items.filter((x) => x.jumpVerified)) {
    const b = document.createElement('button'); b.textContent = r.label; b.onclick = () => jump(r.id); ui.menu.appendChild(b);
  }
  const toggleMenu = () => { ui.menu.hidden = !ui.menu.hidden; if (!ui.menu.hidden && !mobile) input.plc.unlock(); };
  const toggleLight = () => { lighting.setMode(lighting.mode === 'day' ? 'evening' : 'day'); ui.light.textContent = lighting.mode === 'day' ? 'Evening' : 'Day'; };
  function toggleInspect() {
    if (mode === 'walk') {
      mode = 'inspect'; savedQuat.copy(camera.quaternion); input.enabled = false;
      if (!mobile) input.plc.unlock();
      for (const m of house.ceilingMeshes) m.visible = false;
      const r = roomAt(rooms.items, physics.pos.x, physics.pos.z);
      const tgt = r ? new THREE.Vector3((r.boundsThree.min[0] + r.boundsThree.max[0]) / 2, 0.8, (r.boundsThree.min[2] + r.boundsThree.max[2]) / 2)
                    : new THREE.Vector3(4, 0.8, 4.5);
      camera.position.set(tgt.x + 0.01, 11, tgt.z + 5.5);
      orbit = new OrbitControls(camera, canvas); orbit.target.copy(tgt); orbit.enableDamping = true;
      orbit.maxPolarAngle = Math.PI * 0.47; orbit.minDistance = 2; orbit.maxDistance = 22; orbit.update();
      ui.inspect.textContent = 'Walk'; ui.paused.hidden = true;
    } else {
      mode = 'walk'; orbit?.dispose(); orbit = null;
      for (const m of house.ceilingMeshes) m.visible = true;
      camera.quaternion.copy(savedQuat);                                  // back to the safe walking pose
      ui.inspect.textContent = 'Overview'; play();
    }
  }
  $('btn-rooms').onclick = toggleMenu; $('btn-reset').onclick = () => { reset(); play(); };
  ui.light.onclick = toggleLight; ui.inspect.onclick = toggleInspect;

  // ---------------------------------------------------------------- door targeting
  const ray = new THREE.Raycaster(); ray.far = 2.0;
  const occluders = [...house.staticMeshes.filter((m) => !(m.material as THREE.Material).transparent), ...house.doorMeshes];
  const center = new THREE.Vector2(0, 0);
  let target: DoorRuntime | null = null;
  const leafCenter = (d: DoorRuntime) => d.local.clone().applyQuaternion(
    d.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.motion.angle))).add(d.hingePos);
  function findTarget(): DoorRuntime | null {
    ray.setFromCamera(center, camera);
    const hit = ray.intersectObjects(occluders, false)[0];
    if (hit?.object.userData.doorId) return physics.doors.get(hit.object.userData.doorId) ?? null;
    // fallback: nearest visible leaf roughly in front (helps touch users and doorway edges)
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    let best: DoorRuntime | null = null, bd = 1.9;
    for (const d of physics.doors.values()) {
      const c = leafCenter(d); c.y = camera.position.y - 0.3;
      const v = c.clone().sub(camera.position); const dist = v.length();
      if (dist > bd || v.normalize().dot(fwd) < 0.55) continue;
      const r2 = new THREE.Raycaster(camera.position, v, 0, dist + 0.05);
      const h2 = r2.intersectObjects(occluders, false)[0];
      if (h2 && !h2.object.userData.doorId && h2.distance < dist - 0.15) continue;   // a wall is in the way
      best = d; bd = dist;
    }
    return best;
  }
  const interact = () => { if (target && mode === 'walk') physics.toggleDoor(target); };
  canvas.addEventListener('mousedown', () => { if (input.plc.isLocked) interact(); });
  ui.doorbtn.addEventListener('click', interact);
  input.onAction = (a) => {
    if (!started) return;
    if (a === 'interact') interact(); else if (a === 'reset') reset(); else if (a === 'rooms') toggleMenu();
    else if (a === 'lighting') toggleLight(); else if (a === 'inspect') toggleInspect(); else if (a === 'debug') debug.toggle();
    else if (a === 'colliders') debug.toggleColliders(); else if (a === 'help') { if (!mobile) input.plc.unlock(); }
  };
  const promptFor = (d: DoorRuntime) => {
    const s = d.motion.state; const k = mobile ? '' : 'E  ';
    if (s === 'blocked') return 'Door blocked — step back';
    if (s === 'opening' || s === 'open') return `${k}Close door`;
    if (s === 'closing') return `${k}Open door`;
    return `${k}Open door`;
  };

  // ---------------------------------------------------------------- loop (fixed-step physics, one player authority)
  let last = performance.now(), acc = 0;
  let lastRoom = roomAt(rooms.items, physics.pos.x, physics.pos.z);
  document.addEventListener('visibilitychange', () => { last = performance.now(); acc = 0; });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  const wish = new THREE.Vector3();
  const eye = new THREE.Vector3();
  function frame(now: number) { frameOnce(now); requestAnimationFrame(frame); }
  function frameOnce(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;              // clamp after tab switches
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 5) { physics.step(input.wish(speed, wish)); acc -= FIXED_DT; n++; }
    if (n === 5) acc = 0;
    if (mode === 'walk') {
      eye.lerpVectors(physics.prevPos, physics.pos, acc / FIXED_DT);
      camera.position.set(eye.x, eye.y + eyeOffset, eye.z);
      target = findTarget();
      ui.prompt.hidden = !target || !started;
      if (target) { ui.prompt.textContent = promptFor(target); ui.prompt.classList.toggle('blocked', target.motion.state === 'blocked'); }
      ui.doorbtn.hidden = !mobile || !target;
      if (target) ui.doorbtn.textContent = target.motion.state === 'open' || target.motion.state === 'opening' ? 'Close' : 'Open';
    } else { orbit?.update(); ui.prompt.hidden = true; }
    const here = roomAt(rooms.items, physics.pos.x, physics.pos.z);
    if (here) lastRoom = here;                                  // keep the label while crossing a doorway
    const r = here ?? lastRoom;
    ui.room.textContent = r ? r.label : '';
    const lines: [number, number, number, number][] = [];
    for (const d of physics.doors.values()) {
      const q = d.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.motion.angle));
      const tip = new THREE.Vector3(d.def.leafHalfExtentsThree[0] * 2, 0, 0).applyQuaternion(q).add(d.hingePos);
      lines.push([d.hingePos.x, d.hingePos.z, tip.x, tip.z]);
    }
    const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
    minimap.draw(physics.pos.x, physics.pos.z, yaw, lines);
    renderer.render(scene, camera);
    debug.tick(() => `fps ${debug.fps.toFixed(0)}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}\n` +
      `pos ${physics.pos.x.toFixed(2)} ${physics.feetY().toFixed(3)} ${physics.pos.z.toFixed(2)}  grounded ${physics.grounded}\n` +
      `room ${r?.id ?? '-'}  target ${target?.def.id ?? '-'}  mode ${mode}/${lighting.mode}\n` +
      [...physics.doors.values()].map((d) => `${d.def.id} ${d.motion.state} ${(d.motion.angle * 57.3).toFixed(0)}°`).join('  ') +
      `\nmeshes ${house.stats.sourceMeshes}→${house.stats.mergedMeshes}  src tris ${house.stats.triangles}  dpr ${renderer.getPixelRatio()}`);
  }
  requestAnimationFrame(frame);

  // URL test hooks: ?autostart&pose=x,z,yawDeg,pitchDeg&mode=evening&doors=D02,D03&inspect  (verification captures)
  const q = new URLSearchParams(location.search);
  if (q.has('autostart')) {
    started = true; ui.start.hidden = true; ui.hud.hidden = false; setPlaying(true);
    if (q.get('doors')) for (const id of q.get('doors')!.split(',')) { const d = physics.doors.get(id); if (d) { physics.toggleDoor(d); for (let i = 0; i < 60; i++) physics.step(new THREE.Vector3()); } }
    const pose = q.get('pose')?.split(',').map(Number);
    if (pose && pose.length >= 3) { physics.setSpawn([pose[0], 0, pose[1]]); camera.rotation.set(((pose[3] ?? 0) * Math.PI) / 180, (pose[2] * Math.PI) / 180, 0, 'YXZ'); }
    if (q.get('mode') === 'evening') toggleLight();
    if (q.has('inspect')) toggleInspect();
  }

  // ---------------------------------------------------------------- hidden automation hooks (tests)
  (window as any).__sf = {
    state: () => ({ pos: physics.pos.toArray().map((v) => +v.toFixed(3)), feetY: +physics.feetY().toFixed(3), grounded: physics.grounded,
      room: roomAt(rooms.items, physics.pos.x, physics.pos.z)?.id ?? null, target: target?.def.id ?? null,
      doors: Object.fromEntries([...physics.doors.values()].map((d) => [d.def.id, { state: d.motion.state, deg: +(d.motion.angle * 57.2958).toFixed(1) }])),
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fps: +debug.fps.toFixed(1) }),
    teleport: (x: number, y: number, z: number) => physics.setSpawn([x, y, z]),
    look: (yaw: number, pitch = 0) => camera.rotation.set(pitch, yaw, 0, 'YXZ'),
    toggleDoor: (id: string) => { const d = physics.doors.get(id); if (d) physics.toggleDoor(d); },
    interact,
    walk: (vx: number, vz: number, seconds: number) => { const w = new THREE.Vector3(vx, 0, vz); for (let i = 0; i < Math.round(seconds / FIXED_DT); i++) physics.step(w); return (window as any).__sf.state(); },
    idle: (seconds: number) => (window as any).__sf.walk(0, 0, seconds),
    // run n frames synchronously (tests in hidden/background tabs where rAF is paused); returns ms/frame incl. GPU finish
    tick: (n = 1) => { const gl = renderer.getContext(); const t = performance.now(); for (let i = 0; i < n; i++) { last = performance.now() - 1000 / 60; frameOnce(performance.now()); } gl.finish(); return +((performance.now() - t) / n).toFixed(2); },
    player: meta.player,
    phys: physics,
    rooms: rooms.items, spawn, setMode: (m: 'day' | 'evening') => lighting.setMode(m), inspect: toggleInspect, stats: house.stats,
  };
}

boot().catch((e) => {
  console.error(e);
  ui.bar.classList.remove('indeterminate');
  ui.err.hidden = false; ui.enter.hidden = true;
  ui.errmsg.textContent = `The walkthrough could not start: ${e?.message ?? e}`;
  ui.status.textContent = '';
});
ui.retry.onclick = () => location.reload();
