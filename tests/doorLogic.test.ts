import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DoorMotion, planToThree, blenderToThree, IN } from '../src/doorLogic';

const doors = JSON.parse(readFileSync(new URL('../../project/exports/doors.json', import.meta.url), 'utf8')).items;
const cfg = JSON.parse(readFileSync(new URL('../../project/config/active_dimensions.json', import.meta.url), 'utf8'));

describe('DoorMotion', () => {
  it('opens fully in the configured duration and ends in open state', () => {
    const d = new DoorMotion(Math.PI / 2, 0.6);
    d.toggle();
    for (let i = 0; i < 36; i++) d.step(1 / 60, () => true);
    expect(d.progress).toBe(1);
    expect(d.state).toBe('open');
    expect(d.angle).toBeCloseTo(Math.PI / 2, 9);
  });
  it('reverses smoothly from mid-swing without a jump', () => {
    const d = new DoorMotion(-Math.PI / 2, 0.6);
    d.toggle();
    for (let i = 0; i < 12; i++) d.step(1 / 60, () => true);
    const before = d.angle;
    d.toggle();
    expect(d.state).toBe('closing');
    d.step(1 / 60, () => true);
    expect(Math.abs(d.angle - before)).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) d.step(1 / 60, () => true);
    expect(d.state).toBe('closed');
    expect(d.angle).toBe(-0);
  });
  it('stops and reports blocked instead of passing through the player', () => {
    const d = new DoorMotion(Math.PI / 2, 0.6);
    d.toggle();
    for (let i = 0; i < 60; i++) d.step(1 / 60, (a) => a < 0.7);
    expect(d.state).toBe('blocked');
    expect(d.angle).toBeLessThan(0.7);
    d.toggle(); // user toggles again -> door moves away from the obstacle
    expect(d.state).toBe('closing');
  });
  it('after a block, continues the same way once the obstruction has cleared', () => {
    const d = new DoorMotion(Math.PI / 2, 0.6);
    d.toggle();
    for (let i = 0; i < 60; i++) d.step(1 / 60, (a) => a < 0.4);
    expect(d.state).toBe('blocked');
    d.toggle(true);
    expect(d.state).toBe('opening');
    for (let i = 0; i < 60; i++) d.step(1 / 60, () => true);
    expect(d.state).toBe('open');
  });
  it('subdivides a long step so a thin obstacle is not skipped', () => {
    const d = new DoorMotion(Math.PI / 2, 0.6);
    d.toggle();
    d.step(0.5, (a) => !(a > 0.3 && a < 0.35));
    expect(d.state).toBe('blocked');
  });
});

describe('coordinate contract', () => {
  it('maps plan inches to three metres as (x, z, y) * 0.0254', () => {
    expect(planToThree(0, 195, 0)).toEqual([0, 0, 195 * IN]);
    expect(blenderToThree(1, -2, 3)).toEqual([1, 3, 2]);
  });
  it('every exported hinge matches the active plan hinge within 2 mm', () => {
    for (const d of doors) {
      const src = cfg.doors.find((x: any) => x.id === d.id);
      const [x, y, z] = planToThree(src.hinge_xyz[0], src.hinge_xyz[1], src.hinge_xyz[2]);
      expect(Math.hypot(d.hingeWorld[0] - x, d.hingeWorld[1] - y, d.hingeWorld[2] - z)).toBeLessThan(0.002);
    }
  });
  it('outward doors D01/D06 swing to the outside of the footprint', () => {
    const W = cfg.building_outer_xy[2] * IN;
    for (const id of ['D01', 'D06']) {
      const d = doors.find((x: any) => x.id === id);
      const yaw = d.baseYawRad + d.openAngleRad;           // three rotation about +Y
      // leaf local +X after rotation about Y by yaw: (cos, 0, -sin)
      const tip = d.hingeWorld[0] + Math.cos(yaw) * 0.9;
      if (id === 'D01') expect(tip).toBeLessThan(0);
      else expect(tip).toBeGreaterThan(W);
    }
  });
});
