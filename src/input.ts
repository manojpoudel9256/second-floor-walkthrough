import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/** Desktop keys + pointer-lock look, and touch joystick + drag look. Produces a wish direction. */
export class Input {
  keys = new Set<string>();
  plc: PointerLockControls;
  touch = { x: 0, y: 0, active: false };
  isTouch: boolean;
  enabled = false;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  onAction: (a: string) => void = () => {};

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, lookZone: HTMLElement, stick: HTMLElement) {
    this.plc = new PointerLockControls(camera, dom);
    this.plc.pointerSpeed = 0.8;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      this.keys.add(e.code);
      const map: Record<string, string> = { KeyE: 'interact', KeyR: 'reset', KeyM: 'rooms', KeyN: 'lighting', KeyO: 'inspect', KeyH: 'help', Backquote: 'debug', KeyC: 'colliders' };
      if (map[e.code] && !e.repeat) this.onAction(map[e.code]);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.setupTouchLook(lookZone);
    this.setupStick(stick);
  }

  private setupTouchLook(zone: HTMLElement) {
    let id: number | null = null, lx = 0, ly = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY; zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !this.enabled) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= dx * 0.005; this.euler.x = THREE.MathUtils.clamp(this.euler.x - dy * 0.005, -1.45, 1.45);
      this.camera.quaternion.setFromEuler(this.euler);
    });
    const end = (e: PointerEvent) => { if (e.pointerId === id) id = null; };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }

  private setupStick(stick: HTMLElement) {
    const knob = stick.querySelector('.knob') as HTMLElement;
    let id: number | null = null;
    const R = 50;
    const upd = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(x, y); if (l > R) { x *= R / l; y *= R / l; }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.touch.x = x / R; this.touch.y = y / R; this.touch.active = true;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(e.pointerId); upd(e); e.stopPropagation(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) upd(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = null; this.touch = { x: 0, y: 0, active: false }; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
  }

  /** Horizontal wish velocity (m/s) in world space from keys or joystick, normalised on diagonals. */
  wish(speed: number, out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 0, 0);
    if (!this.enabled) return out;
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (this.touch.active) { f = -this.touch.y; s = this.touch.x; }
    const len = Math.hypot(f, s);
    if (len < 0.08) return out;
    const k = Math.min(1, len) / len;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const run = this.keys.has('ShiftLeft') ? 1.6 : 1;
    return out.addScaledVector(fwd, f * k * speed * run).addScaledVector(right, s * k * speed * run);
  }
}
