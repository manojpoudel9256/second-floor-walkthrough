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
  toolbar: $('toolbar'), btnMenu: $('btn-menu'), map: $<HTMLCanvasElement>('minimap'), btnMap: $('btn-map'), full: $('btn-full'), walk: $('btn-walk'),
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
  const dprMax = Math.min(devicePixelRatio, mobile ? 1.5 : 2);
  let dpr = mobile ? Math.min(dprMax, 1.25) : dprMax;                      // adapted to the measured frame time below
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;                                    // redrawn only when a door moves or the light changes
  renderer.shadowMap.needsUpdate = true;
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
  lighting.setMode('evening');                                              // the tour starts at night
  const physics = new Physics(cols.sets, meta);
  for (const d of doorsF.items) physics.addDoor(d, house.hinges.get(d.id)!, house.bases.get(d.id)!);
  const spawn = rooms.spawn;
  physics.setSpawn(spawn.position);
  camera.rotation.set(0, spawn.yawRad, 0, 'YXZ');
  const input = new Input(camera, canvas, $('lookzone'), $('stick'));
  const minimap = new Minimap(ui.map, cols.sets, rooms.items);
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
    closeToolbar(); if (mode === 'inspect') toggleInspect(); play();
  };
  for (const r of rooms.items.filter((x) => x.jumpVerified)) {
    const b = document.createElement('button'); b.textContent = r.label; b.onclick = () => jump(r.id); ui.menu.appendChild(b);
  }
  const closeToolbar = () => { ui.toolbar.hidden = true; ui.menu.hidden = true; ui.btnMenu.setAttribute('aria-expanded', 'false'); };
  const toggleMenu = () => { ui.menu.hidden = !ui.menu.hidden; if (!ui.menu.hidden && !mobile) input.plc.unlock(); };
  const lightLabel = () => { ui.light.textContent = lighting.mode === 'day' ? 'Night' : 'Day'; };
  const toggleLight = () => { lighting.setMode(lighting.mode === 'day' ? 'evening' : 'day'); lightLabel(); renderer.shadowMap.needsUpdate = true; };
  lightLabel();
  const toggleMap = () => { ui.map.classList.toggle('off'); ui.btnMap.textContent = ui.map.classList.contains('off') ? 'Show map' : 'Hide map'; };
  let noteUntil = 0;
  const note = (msg: string) => { ui.prompt.textContent = msg; ui.prompt.classList.remove('blocked'); ui.prompt.hidden = false; noteUntil = performance.now() + 2600; };
  async function toggleFull() {
    const d = document as any, el = document.documentElement as any;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) { await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.()); ui.full.textContent = 'Full screen'; return; }
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      ui.full.textContent = 'Exit full screen';
      if (mobile) await (screen.orientation as any)?.lock?.('landscape');
    } catch { /* iPhone Safari: no element full screen / orientation lock */ }
    if (mobile && innerHeight > innerWidth) note('Turn your phone sideways for landscape');
  }
  function toggleInspect() {
    if (mode === 'walk') {
      mode = 'inspect'; savedQuat.copy(camera.quaternion); input.enabled = false;
      if (!mobile) input.plc.unlock();
      for (const m of house.ceilingMeshes) m.visible = false;
      // frame the whole floor (all rooms + landings), from above and slightly south
      const bx = [Infinity, -Infinity], bz = [Infinity, -Infinity];
      for (const r of rooms.items) for (const v of [r.boundsThree.min, r.boundsThree.max]) {
        bx[0] = Math.min(bx[0], v[0]); bx[1] = Math.max(bx[1], v[0]); bz[0] = Math.min(bz[0], v[2]); bz[1] = Math.max(bz[1], v[2]); }
      const tgt = new THREE.Vector3((bx[0] + bx[1]) / 2, 0.6, (bz[0] + bz[1]) / 2);
      const halfV = THREE.MathUtils.degToRad(camera.fov / 2), halfH = Math.atan(Math.tan(halfV) * camera.aspect);
      const need = Math.max((bz[1] - bz[0]) / 2 / Math.tan(halfV), (bx[1] - bx[0]) / 2 / Math.tan(halfH)) * 1.08;
      camera.position.set(tgt.x, tgt.y + need * 0.93, tgt.z + need * 0.36);
      document.body.classList.add('inspect'); ui.walk.hidden = false; closeToolbar();
      orbit = new OrbitControls(camera, canvas); orbit.target.copy(tgt); orbit.enableDamping = true;
      orbit.maxPolarAngle = Math.PI * 0.47; orbit.minDistance = 2; orbit.maxDistance = 30; orbit.update();
      ui.inspect.textContent = 'Walk'; ui.paused.hidden = true;
    } else {
      mode = 'walk'; orbit?.dispose(); orbit = null;
      document.body.classList.remove('inspect'); ui.walk.hidden = true;
      for (const m of house.ceilingMeshes) m.visible = true;
      camera.quaternion.copy(savedQuat);                                  // back to the safe walking pose
      ui.inspect.textContent = 'Overview'; play();
    }
  }
  ui.btnMenu.onclick = () => {
    const open = ui.toolbar.hidden; closeToolbar(); ui.toolbar.hidden = !open; ui.btnMenu.setAttribute('aria-expanded', String(open));
    if (open && !mobile) input.plc.unlock();
  };
  $('btn-rooms').onclick = toggleMenu; $('btn-reset').onclick = () => { closeToolbar(); reset(); play(); };
  ui.light.onclick = () => { toggleLight(); closeToolbar(); }; ui.inspect.onclick = toggleInspect;
  ui.walk.onclick = () => { if (mode === 'inspect') toggleInspect(); };
  ui.btnMap.onclick = () => { toggleMap(); closeToolbar(); }; ui.map.onclick = toggleMap;
  ui.full.onclick = () => { closeToolbar(); toggleFull(); };
  // the controls dim when you have not touched anything for a few seconds
  let idleTimer = 0;
  const wake = () => { ui.hud.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = window.setTimeout(() => ui.hud.classList.add('idle'), 3500); };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, wake, { passive: true });
  wake();

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
  const onResize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', onResize);
  addEventListener('orientationchange', () => setTimeout(onResize, 250));
  visualViewport?.addEventListener('resize', onResize);
  const wish = new THREE.Vector3();
  const vel = new THREE.Vector3();                                          // eased walking velocity (no jerky starts/stops)
  const ACCEL = 1 - Math.exp(-FIXED_DT * 9);
  const eye = new THREE.Vector3();
  let eyeY = NaN;                                                           // low-passed eye height (softens threshold steps)
  let frameMs = 16.7, adaptT = 0;
  function frame(now: number) { frameOnce(now); requestAnimationFrame(frame); }
  function frameOnce(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;              // clamp after tab switches
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 5) {
      input.wish(speed, wish); vel.lerp(wish, ACCEL);
      if (wish.lengthSq() === 0 && vel.lengthSq() < 1e-4) vel.set(0, 0, 0);
      physics.step(vel); acc -= FIXED_DT; n++;
    }
    if (n === 5) acc = 0;
    if (mode === 'walk') {
      eye.lerpVectors(physics.prevPos, physics.pos, acc / FIXED_DT);
      const ty = eye.y + eyeOffset;
      eyeY = Number.isNaN(eyeY) || Math.abs(ty - eyeY) > 0.5 ? ty : eyeY + (ty - eyeY) * (1 - Math.exp(-dt * 14));
      camera.position.set(eye.x, eyeY, eye.z);
      target = findTarget();
      const noting = performance.now() < noteUntil;
      ui.prompt.hidden = !noting && (!target || !started);
      if (target && !noting) { ui.prompt.textContent = promptFor(target); ui.prompt.classList.toggle('blocked', target.motion.state === 'blocked'); }
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
    for (const f of house.fans) f.node.rotateY(-f.rps * 2 * Math.PI * dt);
    for (const d of physics.doors.values()) if (d.motion.state === 'opening' || d.motion.state === 'closing') { renderer.shadowMap.needsUpdate = true; break; }
    renderer.render(scene, camera);
    // adaptive resolution: keep the frame rate up on slower phones, sharpen when there is headroom
    frameMs += (dt * 1000 - frameMs) * 0.05; adaptT += dt;
    if (adaptT > 2 && mode === 'walk' && !document.hidden) {
      adaptT = 0;
      const next = frameMs > 24 ? Math.max(0.75, dpr - 0.15) : frameMs < 15 ? Math.min(dprMax, dpr + 0.1) : dpr;
      if (Math.abs(next - dpr) > 0.01) { dpr = +next.toFixed(2); renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight, false); }
    }
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
    if (q.get('mode') === 'day') toggleLight();
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
    rooms: rooms.items, spawn, setMode: (m: 'day' | 'evening') => { lighting.setMode(m); lightLabel(); renderer.shadowMap.needsUpdate = true; },
    inspect: toggleInspect, stats: house.stats, fans: house.fans.length, dpr: () => dpr,
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
