// Browser route/door test, run in the live page (uses the real Rapier world via window.__sf).
// Paste into the console or run through automation; returns a results array.
// Coordinates: three = (planX, z, planY) * 0.0254.
(() => {
  const S = window.__sf, IN = 0.0254, P = (x, y) => [x * IN, 0, y * IN];
  const out = [];
  const rec = (name, pass, detail) => out.push({ name, pass: !!pass, detail });
  const tp = (x, y, yaw = 0) => { const p = P(x, y); S.teleport(p[0], 0, p[2]); S.look(yaw); };
  const closeAll = () => {                              // stand clear at the spawn first, so no door closes onto the tester
    S.teleport(...S.spawn.position);
    for (let k = 0; k < 3; k++) { for (const [id, d] of Object.entries(S.state().doors)) if (d.state !== 'closed') S.toggleDoor(id); S.idle(1); }
  };
  const open = (id) => { if (S.state().doors[id].state !== 'open') S.toggleDoor(id); for (let t = 0; t < 30 && !['open', 'blocked'].includes(S.state().doors[id].state); t++) S.idle(0.1); return S.state().doors[id]; };
  const V = 1.4;

  // 1 spawn -> passage -> O01 -> living
  S.teleport(...S.spawn.position); S.look(S.spawn.yawRad);
  let s = S.state(); rec('spawn is grounded in R04', s.grounded && s.room === 'R04', s);
  s = S.walk(-V, 0, 3.2); rec('passage -> O01 -> living (open cased opening)', s.room === 'R01', s);

  // 2 closed D03 blocks; open D03 admits into R03
  closeAll(); tp(181, 183); s = S.walk(0, -V, 1.5);
  rec('closed D03 blocks passage -> R03', s.room === 'R04' && s.pos[2] > 153 * IN, s);
  rec('D03 opens (into bedroom)', open('D03').state === 'open', S.state().doors.D03);
  s = S.walk(0, -V, 2.5); rec('open D03 -> R03 reachable', s.room === 'R03', s);

  // 3 D04 common bath with +50 mm threshold (autostep)
  closeAll(); tp(178, 190); s = S.walk(0, V, 1.2); rec('closed D04 blocks', s.room === 'R04', s);
  open('D04'); s = S.walk(0, V, 2.0);
  rec('open D04 -> R05, feet on bath FFL +0.05', s.room === 'R05' && Math.abs(s.feetY - 0.07) < 0.03, s);
  s = S.walk(0, -V, 2.2); rec('R05 -> back to passage over threshold', s.room === 'R04' && Math.abs(s.feetY - 0.02) < 0.03, s);

  // 4 living -> D02 -> R02 -> D05 -> R06
  closeAll(); tp(129, 190); s = S.walk(0, V, 1.2); rec('closed D02 blocks', s.room === 'R01', s);
  open('D02'); s = S.walk(0, V, 1.6); rec('open D02 -> R02', s.room === 'R02', s);
  tp(135, 305); s = S.walk(V, 0, 1.2); rec('closed D05 blocks', s.room === 'R02', s);
  const p0 = S.state().pos;
  S.toggleDoor('D05'); for (let t = 0; t < 30 && S.state().doors.D05.state !== 'open'; t++) S.idle(0.1);
  const p1 = S.state().pos;
  rec('opening D05 toward the player: player steps back, door opens fully', S.state().doors.D05.state === 'open' && Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.05, { ...S.state().doors.D05, stepBack_m: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(3) });
  tp(118, 305); s = S.walk(V, 0, 2.2); rec('open D05 -> R06 (feet +0.05)', s.room === 'R06' && Math.abs(s.feetY - 0.07) < 0.03, s);

  // 5 exterior doors to protected landings, guards hold
  closeAll(); tp(20, 177); s = S.walk(-V, 0, 1.2); rec('closed D01 blocks', s.room === 'R01', s);
  const d1 = open('D01'); rec('D01 opens outward', d1.state === 'open', d1);
  s = S.walk(-V, 0, 5.0); rec('D01 -> balcony B01, parapet stops the player', s.room === 'B01' && s.pos[0] > -76 * IN, s);
  closeAll(); tp(300, 183); open('D06'); s = S.walk(V, 0, 5.0);
  rec('D06 -> terrace B02, parapet stops the player', s.room === 'B02' && s.pos[0] < 391 * IN, s);

  // 6 stair head boundary and well guard
  closeAll(); tp(288, 215); s = S.walk(0, V, 3.0); rec('stair head nav boundary (no falling)', s.pos[2] < 236 * IN && s.feetY > -0.1, s);
  tp(245, 215); s = S.walk(0, V, 3.0); rec('well guard holds', s.pos[2] < 234 * IN && s.feetY > -0.1, s);

  // 7 door blocked by the player standing in its swing
  closeAll(); open('D02'); tp(129, 222); S.toggleDoor('D02'); S.idle(1.0);
  const d2 = S.state().doors.D02; rec('closing D02 onto the player -> blocked, not pushed', d2.state === 'blocked' && d2.deg > 5, d2);
  S.toggleDoor('D02'); S.idle(1.0); rec('re-toggle backs the door away (opens)', S.state().doors.D02.state === 'open', S.state().doors.D02);

  // 8 furniture is not climbable; walls not passable
  closeAll(); tp(95, 110); s = S.walk(0, V, 2.0); rec('sofa blocks (not stepped onto)', s.feetY < 0.1 && s.pos[2] < 160 * IN, s);   // sofa on the south wall (A9)
  tp(81, 95); s = S.walk(-V * 3, 0, 4); rec('exterior wall E04 holds at speed', s.pos[0] > 9 * IN, s);

  // 9 bathroom shower (A9): the glass screen is walk-in from the north and blocks a sideways exit
  closeAll(); open('D04'); tp(178, 232); s = S.walk(0, V, 2.0); rec('R05 shower zone reachable from the north', s.room === 'R05' && s.pos[2] > 250 * IN, s);
  s = S.walk(V, 0, 1.5); rec('glass screen blocks eastward exit', s.pos[0] < 194 * IN, s);

  // 10 balconies (A10): outdoor furniture is solid; the gap between B01's lounge chairs stays free (D01 step-back zone)
  closeAll(); open('D01'); tp(-20, 158); s = S.walk(-V, 0, 2.0); rec('B01: lounge chair is solid', s.room === 'B01' && s.pos[0] > -42 * IN, s);
  closeAll(); open('D06'); tp(330, 183); s = S.walk(V, 0, 2.0); rec('B02: bistro table is solid', s.room === 'B02' && s.pos[0] < 358 * IN, s);

  closeAll(); S.teleport(...S.spawn.position); S.look(S.spawn.yawRad);
  return { passed: out.filter((r) => r.pass).length, total: out.length, results: out };
})();
