// Pure door motion state machine (no three/rapier imports, unit-tested in tests/).
// progress 0 = closed, 1 = fully open. The rendered hinge angle is openAngle * ease(progress),
// so reversing mid-swing is continuous in position.

export type DoorState = 'closed' | 'opening' | 'open' | 'closing' | 'blocked' | 'ajar';

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class DoorMotion {
  progress = 0;
  dir: -1 | 0 | 1 = 0;
  lastDir: -1 | 1 = -1;
  blocked = false;

  constructor(readonly openAngle: number, readonly duration = 0.6) {}

  get angle(): number {
    return this.openAngle * easeInOut(this.progress);
  }

  /** Hinge angles (every ~2 deg) from the current position to the end of the last direction of travel. */
  remainingAngles(): number[] {
    const end = this.lastDir > 0 ? 1 : 0;
    const span = Math.abs(end - this.progress);
    const n = Math.max(1, Math.ceil((span * 2 * Math.abs(this.openAngle)) / 0.035));
    const out: number[] = [];
    for (let i = 1; i <= n; i++) out.push(this.angleAt(this.progress + ((end - this.progress) * i) / n));
    return out;
  }

  angleAt(progress: number): number {
    return this.openAngle * easeInOut(progress);
  }

  get state(): DoorState {
    if (this.blocked) return 'blocked';
    if (this.dir > 0) return 'opening';
    if (this.dir < 0) return 'closing';
    if (this.progress >= 1) return 'open';
    if (this.progress <= 0) return 'closed';
    return 'ajar';
  }

  /** Toggle: start opening/closing, or reverse the current motion. After a block, continue the same
   * way if the obstruction has cleared (`canContinue`), otherwise back away from it. */
  toggle(canContinue = false): void {
    if (this.blocked) this.dir = canContinue ? this.lastDir : (this.lastDir > 0 ? -1 : 1);
    else if (this.dir === 0) this.dir = this.progress < 0.5 ? 1 : -1;
    else this.dir = this.dir > 0 ? -1 : 1;
    this.blocked = false;
    this.lastDir = this.dir as -1 | 1;
  }

  /**
   * Advance by dt. `canOccupy(angle)` must return false if the leaf at that hinge angle would
   * overlap the player; the door then stops where it is and reports 'blocked'.
   * Travel is subdivided so a fast step cannot skip over a thin obstacle.
   */
  step(dt: number, canOccupy: (angle: number) => boolean): void {
    if (this.dir === 0) return;
    const total = (this.dir * dt) / this.duration;
    // max easing slope is 2, so this bounds each sub-step to <= 0.02 rad (~1.1 deg) of leaf travel
    const n = Math.max(1, Math.ceil((Math.abs(total) * 2 * Math.abs(this.openAngle)) / 0.02));
    for (let i = 0; i < n; i++) {
      let next = Math.min(1, Math.max(0, this.progress + total / n));
      if (next > 1 - 1e-9) next = 1;
      if (next < 1e-9) next = 0;
      if (!canOccupy(this.angleAt(next))) {
        this.blocked = true;
        this.dir = 0;
        return;
      }
      this.progress = next;
      if (next === 0 || next === 1) {
        this.dir = 0;
        return;
      }
    }
  }
}

// ---- coordinate contract (plan inches -> three metres), kept here for tests and debugging
export const IN = 0.0254;
export const planToThree = (x: number, y: number, z = 0): [number, number, number] => [x * IN, z * IN, y * IN];
export const blenderToThree = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];
