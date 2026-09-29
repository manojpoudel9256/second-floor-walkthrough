import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ColliderSets, DoorDef, SceneMeta, V3 } from './types';
import { DoorMotion } from './doorLogic';

export const FIXED_DT = 1 / 60;
// Measured in the browser: the character controller starts nudging the player when a moving leaf is
// ~5-8 cm away, so the door must stop 8 cm short (0.04 still let a closing door ratchet people 0.22 m).
export const DOOR_CLEARANCE = 0.08;
const UP = new THREE.Vector3(0, 1, 0);
const YIELD_SPEED = 0.9;       // m/s: a person steps back while a door opens toward them
const YIELD_MAX_S = 1.0;       // after this long without room to step back, the door reports "blocked"

export interface DoorRuntime {
  def: DoorDef;
  motion: DoorMotion;
  hinge: THREE.Object3D;
  baseQuat: THREE.Quaternion;
  hingePos: THREE.Vector3;
  body: RAPIER.RigidBody;
  shape: RAPIER.Cuboid;
  local: THREE.Vector3;
  holdS: number;
  collider: RAPIER.Collider;
}

/** Rapier world: static colliders from colliders.json, a kinematic capsule player driven by the
 * character controller, and one kinematic body per door leaf that follows its hinge each step. */
export class Physics {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  doors = new Map<string, DoorRuntime>();
  doorColliders = new Set<number>();
  private probe!: RAPIER.Capsule;
  pos = new THREE.Vector3();
  prevPos = new THREE.Vector3();
  vy = 0;
  grounded = false;
  lastSafe = new THREE.Vector3();
  readonly radius: number;
  readonly halfHeight: number;

  constructor(cols: ColliderSets, meta: SceneMeta) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const set of [cols.static, cols.floor, cols.nav, cols.furniture]) {
      for (const b of set) {
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]).setTranslation(b.c[0], b.c[1], b.c[2]), fixed);
      }
    }
    const p = meta.player;
    this.radius = p.radius_m;
    this.halfHeight = (p.height_m - 2 * p.radius_m) / 2;           // 0.60 for 1.70 m / 0.25 m
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius), this.body);
    this.probe = new RAPIER.Capsule(this.halfHeight, this.radius);
    this.controller = this.world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.controller.enableAutostep(p.maxStep_m, 0.12, false);     // bath threshold 0.05 m; sofa/bed are far higher
    this.controller.enableSnapToGround(0.12);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  addDoor(def: DoorDef, hinge: THREE.Object3D, base: THREE.Object3D) {
    base.updateMatrixWorld(true);
    const baseQuat = base.getWorldQuaternion(new THREE.Quaternion());
    const hingePos = base.getWorldPosition(new THREE.Vector3());
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(hingePos.x, hingePos.y, hingePos.z).setRotation(baseQuat));
    const h = def.leafHalfExtentsThree, c = def.leafLocalCenterThree;
    // query shape is inflated by DOOR_CLEARANCE (> controller offset 0.02 m) so a closing leaf stops
    // before it can enter the character controller's skin; otherwise the KCC nudges the player out of the
    // way every frame and the door ratchets the player through the doorway.
    const shape = new RAPIER.Cuboid(h[0] + DOOR_CLEARANCE, h[1], h[2] + DOOR_CLEARANCE);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(h[0], h[1], h[2]).setTranslation(c[0], c[1], c[2]), body);
    this.doorColliders.add(collider.handle);
    this.doors.set(def.id, { def, motion: new DoorMotion(def.openAngleRad, def.durationS), hinge, baseQuat, hingePos, body, shape,
                             local: new THREE.Vector3(...c), holdS: 0, collider });
  }

  leafPose(d: DoorRuntime, angle: number) {
    const q = d.baseQuat.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    const c = d.local.clone().applyQuaternion(q).add(d.hingePos);
    return { q, c };
  }

  /** True if the player capsule at `p` would touch nothing except door leaves (walls, furniture, frames...). */
  capsuleFree(p: THREE.Vector3): boolean {
    let hit = false;
    this.world.intersectionsWithShape(p, { x: 0, y: 0, z: 0, w: 1 }, this.probe, () => { hit = true; return false; },
      undefined, undefined, this.collider, undefined, (col) => !this.doorColliders.has(col.handle));
    return !hit;
  }

  /** True if the leaf at `angle` would not overlap the player capsule. */
  doorCanOccupy(d: DoorRuntime, angle: number): boolean {
    const { q, c } = this.leafPose(d, angle);
    let hit = false;
    this.world.intersectionsWithShape(c, q, d.shape, () => { hit = true; return false; },
      undefined, undefined, undefined, undefined, (col) => col.handle === this.collider.handle);
    return !hit;
  }

  toggleDoor(d: DoorRuntime) {
    // after a block: carry on only if the whole remaining swing is now clear, otherwise back away
    d.motion.toggle(d.motion.blocked && d.motion.remainingAngles().every((a) => this.doorCanOccupy(d, a)));
  }

  setSpawn(p: V3 | THREE.Vector3) {
    const v = Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone();
    this.pos.set(v.x, v.y + this.halfHeight + this.radius + 0.02, v.z);
    this.prevPos.copy(this.pos); this.lastSafe.copy(this.pos); this.vy = 0;
    this.body.setTranslation(this.pos, true);
    this.body.setNextKinematicTranslation(this.pos);
    this.world.step();
    this.grounded = false;
    const still = new THREE.Vector3();
    for (let i = 0; i < 4; i++) this.step(still);                  // settle onto the floor (snap + grounded flag)
    this.prevPos.copy(this.pos);
  }

  /** One fixed step: yield push -> player -> doors (checked against the player's NEW position) -> world.step(). */
  step(wish: THREE.Vector3) {
    // A door OPENING toward the player makes them step back (through the character controller, so
    // walls and furniture still stop them). Closing doors never push: they stop and report blocked.
    const push = new THREE.Vector3();
    for (const d of this.doors.values()) {
      const m = d.motion;
      if (m.dir === 0 || m.blocked) { d.holdS = 0; continue; }
      const next = m.angleAt(Math.min(1, Math.max(0, m.progress + (m.dir * FIXED_DT) / m.duration)));
      if (this.doorCanOccupy(d, next)) { d.holdS = 0; continue; }
      if (m.dir > 0) {
        // step out of the leaf's swept circle: radially away from the hinge, or side-step if furniture is in the way
        const radial = new THREE.Vector3(this.pos.x - d.hingePos.x, 0, this.pos.z - d.hingePos.z);
        if (radial.lengthSq() > 1e-8) {
          radial.normalize();
          for (const deg of [0, 35, -35, 70, -70, 105, -105]) {
            const dir = radial.clone().applyAxisAngle(UP, (deg * Math.PI) / 180);
            const probe = this.pos.clone().addScaledVector(dir, YIELD_SPEED * FIXED_DT * 3);
            probe.y += 0.01;
            if (this.capsuleFree(probe)) { push.addScaledVector(dir, YIELD_SPEED); break; }
          }
        }
      }
      d.holdS += FIXED_DT;
    }
    if (push.lengthSq() > 0) {
      // step back directly (the KCC resists moving out of an initial overlap), but only into free space
      if (push.length() > YIELD_SPEED) push.setLength(YIELD_SPEED);
      const target = this.pos.clone().addScaledVector(push, FIXED_DT);
      target.y += 0.01;                                        // probe just above the floor contact
      if (this.capsuleFree(target)) { target.y -= 0.01; this.pos.copy(target); this.collider.setTranslation(this.pos); }
    }
    this.vy = this.grounded ? -0.5 : Math.max(-20, this.vy - 9.81 * FIXED_DT);
    const desired = { x: wish.x * FIXED_DT, y: this.vy * FIXED_DT, z: wish.z * FIXED_DT };
    this.controller.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    this.prevPos.copy(this.pos);
    this.pos.set(this.pos.x + mv.x, this.pos.y + mv.y, this.pos.z + mv.z);
    if (this.grounded && this.pos.y > -0.5) this.lastSafe.copy(this.pos);
    if (this.pos.y < -1.5) { this.pos.copy(this.lastSafe); this.prevPos.copy(this.pos); this.vy = 0; }  // never fall out
    this.body.setNextKinematicTranslation(this.pos);
    this.collider.setTranslation(this.pos);           // door queries below see this step's player position
    for (const d of this.doors.values()) {
      const m = d.motion;
      const opening = m.dir > 0;
      // an opening door waits (up to YIELD_MAX_S) while the player steps back; otherwise normal stepping
      if (!(opening && d.holdS > 0 && d.holdS < YIELD_MAX_S && !this.doorCanOccupy(d, m.angleAt(Math.min(1, m.progress + FIXED_DT / m.duration))))) {
        m.step(FIXED_DT, (a) => this.doorCanOccupy(d, a));
      }
      d.hinge.rotation.y = m.angle;
      const { q } = this.leafPose(d, m.angle);
      d.body.setNextKinematicTranslation(d.hingePos);
      d.body.setNextKinematicRotation(q);
    }
    this.world.step();
  }

  feetY(): number { return this.pos.y - this.halfHeight - this.radius; }
}
