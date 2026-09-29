import type { BoxDef, ColliderSets, RoomDef } from './types';

export function roomAt(rooms: RoomDef[], x: number, z: number): RoomDef | null {
  for (const r of rooms) {
    const a = r.boundsThree.min, b = r.boundsThree.max;
    if (x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]) && z >= Math.min(a[2], b[2]) && z <= Math.max(a[2], b[2])) return r;
  }
  return null;
}

/** Top-down minimap drawn from the same collider data the physics uses. */
export class Minimap {
  private base: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private s: number;
  private ox = -2.1;
  private oz = -0.3;

  constructor(private canvas: HTMLCanvasElement, cols: ColliderSets, rooms: RoomDef[]) {
    const W = 12.2, D = 9.6;
    this.s = Math.min(canvas.width / W, canvas.height / D);
    this.base = document.createElement('canvas');
    this.base.width = canvas.width; this.base.height = canvas.height;
    const g = this.base.getContext('2d')!;
    const rect = (b: BoxDef, fill: string) => {
      g.fillStyle = fill;
      g.fillRect((b.c[0] - b.h[0] - this.ox) * this.s, (b.c[2] - b.h[2] - this.oz) * this.s, 2 * b.h[0] * this.s, 2 * b.h[2] * this.s);
    };
    for (const b of cols.floor) if (b.c[1] + b.h[1] > -0.2 && b.id !== 'OUTSIDE__GROUND') rect(b, 'rgba(255,255,255,0.16)');
    for (const b of cols.furniture) rect(b, 'rgba(214,184,140,0.45)');
    for (const b of cols.static) if (b.h[1] > 0.4) rect(b, 'rgba(255,255,255,0.82)');
    g.font = '600 10px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.8)'; g.textAlign = 'center';
    for (const r of rooms) {
      if (!r.id.startsWith('R') || r.id === 'R07') continue;
      const cx = (r.boundsThree.min[0] + r.boundsThree.max[0]) / 2, cz = (r.boundsThree.min[2] + r.boundsThree.max[2]) / 2;
      g.fillText(r.label.replace(/ \(.*\)/, ''), (cx - this.ox) * this.s, (cz - this.oz) * this.s);
    }
    this.ctx = canvas.getContext('2d')!;
  }

  draw(x: number, z: number, yaw: number, doorLines: [number, number, number, number][]) {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.strokeStyle = '#ffb45c'; c.lineWidth = 2.5;
    for (const [x0, z0, x1, z1] of doorLines) {
      c.beginPath(); c.moveTo((x0 - this.ox) * this.s, (z0 - this.oz) * this.s); c.lineTo((x1 - this.ox) * this.s, (z1 - this.oz) * this.s); c.stroke();
    }
    const px = (x - this.ox) * this.s, pz = (z - this.oz) * this.s;
    c.save(); c.translate(px, pz); c.rotate(-yaw);
    c.fillStyle = '#4ea1ff'; c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 6); c.lineTo(0, 3); c.lineTo(-6, 6); c.closePath(); c.fill();
    c.restore();
  }
}
