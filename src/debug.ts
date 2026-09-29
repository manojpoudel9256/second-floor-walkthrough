import * as THREE from 'three';
import type { ColliderSets } from './types';

/** Hidden developer overlay (backquote key or ?debug=1): FPS, draw calls, player/door state,
 * axes and collider wireframes (C). Never shown to normal users by default. */
export class Debug {
  el: HTMLElement;
  visible = false;
  group = new THREE.Group();
  private frames = 0;
  private t0 = performance.now();
  fps = 0;

  constructor(scene: THREE.Scene, cols: ColliderSets) {
    this.el = document.getElementById('debug')!;
    const mk = (color: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    const add = (list: { c: number[]; h: number[] }[], color: number) => {
      for (const b of list) {
        const l = new THREE.LineSegments(edges, mk(color));
        l.position.set(b.c[0], b.c[1], b.c[2]); l.scale.set(2 * b.h[0], 2 * b.h[1], 2 * b.h[2]);
        this.group.add(l);
      }
    };
    add(cols.static, 0xff3b30); add(cols.nav, 0xff00ff); add(cols.furniture, 0xff9500);
    this.group.add(new THREE.AxesHelper(1));
    this.group.visible = false;
    this.group.renderOrder = 999;
    scene.add(this.group);
    if (new URLSearchParams(location.search).has('debug')) this.toggle();
  }

  toggle() { this.visible = !this.visible; this.el.hidden = !this.visible; }
  toggleColliders() { this.group.visible = !this.group.visible; }

  tick(text: () => string) {
    this.frames++;
    const now = performance.now();
    if (now - this.t0 > 500) { this.fps = (this.frames * 1000) / (now - this.t0); this.frames = 0; this.t0 = now; if (this.visible) this.el.textContent = text(); }
  }
}
