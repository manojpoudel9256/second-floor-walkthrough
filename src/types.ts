export type V3 = [number, number, number];

export interface DoorDef {
  id: string;
  label: string;
  baseNode: string;
  hingeNode: string;
  leafNode: string;
  hingeWorld: V3;
  baseYawRad: number;
  closedAngleRad: number;
  openAngleRad: number;
  durationS: number;
  exterior: boolean;
  leafLocalCenterThree: V3;
  leafHalfExtentsThree: V3;
}

export interface BoxDef { id: string; c: V3; h: V3 }

export interface ColliderSets {
  static: BoxDef[];
  floor: BoxDef[];
  nav: BoxDef[];
  furniture: BoxDef[];
  ramps?: (BoxDef & { q: [number, number, number, number] })[];   // stair flights (rotated boxes)
}

export interface RoomDef {
  id: string;
  label: string;
  floorY: number;
  boundsThree: { min: V3; max: V3 };
  jumpPoint: V3 | null;
  jumpVerified: boolean;
  photoIdentity?: string | null;
}

export interface RoomsFile {
  revision: string;
  spawn: { position: V3; yawRad: number; room: string; note: string };
  items: RoomDef[];
}

export interface LightDef {
  id: string;
  type: string;
  position: V3;
  color: V3;
  watts: number;
  room: string;
  kelvin?: number;
  direction: V3;
}

export interface SceneMeta {
  revision: string;
  status: string;
  player: { radius_m: number; height_m: number; eye_m: number; walk_m_s: number; maxStep_m: number };
  glb: { file: string; bytes: number; sha256: string };
  [k: string]: unknown;
}
