import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { LightDef, RoomDef } from './types';

/** Deliberate web light set: sun (with one shadow map), hemisphere fill, a PMREM environment for
 * reflections, and one unshadowed point light per room placed at a Blender downlight position. */
export class Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  roomLights: THREE.PointLight[] = [];
  mode: 'day' | 'evening' = 'day';

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, lights: LightDef[], rooms: RoomDef[], mobile: boolean) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.hemi = new THREE.HemisphereLight(0xeaf0f8, 0x8d8272, 1.0);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
    this.sun.position.set(-9, 11, 3.2);                          // from the west facade (assumption A28)
    this.sun.target.position.set(4, 0, 4.6);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    Object.assign(s.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    s.bias = -0.0004; s.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    for (const r of rooms) {
      if (!r.id.startsWith('R')) continue;
      const cands = lights.filter((l) => l.room === r.id && l.type !== 'SUN');
      if (!cands.length) continue;
      const cx = (r.boundsThree.min[0] + r.boundsThree.max[0]) / 2, cz = (r.boundsThree.min[2] + r.boundsThree.max[2]) / 2;
      cands.sort((a, b) => Math.hypot(a.position[0] - cx, a.position[2] - cz) - Math.hypot(b.position[0] - cx, b.position[2] - cz));
      const l = cands[0];
      const warm = (l.kelvin ?? 3000) <= 3000;
      const pl = new THREE.PointLight(warm ? 0xffc890 : 0xffe6cc, 0, r.id === 'R01' ? 9 : 7, 2);
      pl.position.set(l.position[0], l.position[1] - 0.25, l.position[2]);
      pl.userData = { room: r.id, base: r.id === 'R01' ? 6 : r.id.match(/R0[56]/) ? 3 : 4 };
      scene.add(pl); this.roomLights.push(pl);
    }
    this.setMode('day');
  }

  setMode(m: 'day' | 'evening') {
    this.mode = m;
    const day = m === 'day';
    this.sun.intensity = day ? 3.4 : 0;
    this.sun.castShadow = day;
    this.hemi.intensity = day ? 0.55 : 0.06;
    this.hemi.color.set(day ? 0xeaf0f8 : 0x33405a);
    this.scene.environmentIntensity = day ? 0.32 : 0.1;
    this.scene.background = new THREE.Color(day ? 0xcfdcea : 0x0b1120);
    for (const l of this.roomLights) l.intensity = (day ? 1.2 : 1.9) * l.userData.base;
  }
}
