// Doorway stress test in the live page (real Rapier world via window.__sf).
// For every door, from BOTH sides, at 5 lateral offsets across the clear opening (limited to what a
// capsule can physically fit), walk straight through with the door open; pass = ends in the far room.
// Then: close the door onto a player standing in the doorway -> must report "blocked" and must not move
// the player (the old bug: the door ratcheted people through the doorway / outside).
(() => {
  const S = window.__sf, IN = 0.0254, V = 1.4;
  const R = (S.player && S.player.radius_m) || 0.22;
  // plan inches: axis of travel, wall centre-line, clear span along the wall, start coordinate each side, rooms
  const doors = {
    D01: { axis: 'x', wall: 4.5, span: [159, 195], a: { at: -30, room: 'B01' }, b: { at: 40, room: 'R01' } },
    D02: { axis: 'y', wall: 203.25, span: [111, 147], a: { at: 185, room: 'R01' }, b: { at: 236, room: 'R02' } },
    D03: { axis: 'y', wall: 162.75, span: [163.5, 199.5], a: { at: 132, room: 'R03' }, b: { at: 183, room: 'R04' } },
    D04: { axis: 'y', wall: 203.25, span: [163.5, 193.5], a: { at: 183, room: 'R04' }, b: { at: 236, room: 'R05' } },
    D05: { axis: 'x', wall: 155.25, span: [289.5, 319.5], a: { at: 124, room: 'R02' }, b: { at: 186, room: 'R06' } },
    D06: { axis: 'x', wall: 310.5, span: [165, 201], a: { at: 282, room: 'R04' }, b: { at: 345, room: 'B02' } },
  };
  const out = [];
  const FLOOR = Object.fromEntries(S.rooms.map((r) => [r.id, r.floorY]));
  const closeAll = () => {                              // stand clear first so no door is blocked by the tester
    S.teleport(...S.spawn.position);
    for (let k = 0; k < 3; k++) { for (const [id, d] of Object.entries(S.state().doors)) if (d.state !== 'closed') S.toggleDoor(id); S.idle(1); }
  };
  const openD = (id) => {                               // wait until fully open (the player may step back first) or blocked
    if (S.state().doors[id].state !== 'open') S.toggleDoor(id);
    for (let t = 0; t < 30 && !['open', 'blocked'].includes(S.state().doors[id].state); t++) S.idle(0.1);
    return S.state().doors[id].state;
  };
  const P = (d, along, lat) => (d.axis === 'x' ? [along * IN, 0, lat * IN] : [lat * IN, 0, along * IN]);
  closeAll();
  for (const [id, d] of Object.entries(doors)) {
    const mid = (d.span[0] + d.span[1]) / 2;
    const reach = Math.max(0, (d.span[1] - d.span[0]) / 2 - R / IN - 1.0);    // lateral room left for the capsule
    for (const [from, to] of [[d.a, d.b], [d.b, d.a]]) {
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        closeAll();
        const lat = mid + f * reach;
        const p = P(d, from.at, lat);
        S.teleport(p[0], FLOOR[from.room] ?? 0, p[2]);          // start ON that room's finished floor
        const st = openD(id);                                  // open from where a person would stand
        const dir = Math.sign(to.at - from.at);
        const dist = Math.abs(to.at - from.at) * IN;
        const v = d.axis === 'x' ? [dir * V, 0] : [0, dir * V];
        const s = S.walk(v[0], v[1], (dist + 0.9) / V);   // +0.8 m: the player may have stepped back while the door opened
        out.push({ door: id, route: `${from.room}->${to.room}`, lateral_in: +(lat - mid).toFixed(1), doorWas: st, pass: s.room === to.room, room: s.room, pos: s.pos });
      }
    }
    // close onto a player standing in the middle of the doorway
    closeAll(); openD(id);
    const mp = P(d, d.wall, mid);
    S.teleport(mp[0], 0, mp[2]);
    const before = S.state();
    S.toggleDoor(id); S.idle(1.2);
    const after = S.state();
    const moved = Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]);
    out.push({ door: id, route: 'close-onto-player', pass: after.doors[id].state === 'blocked' && moved < 0.01,
               moved_m: +moved.toFixed(3), doorState: after.doors[id].state, deg: after.doors[id].deg });
  }
  // never outside the footprint except on the two balconies
  const outside = out.filter((r) => r.pos && r.room === null);
  closeAll(); S.teleport(...S.spawn.position); S.look(S.spawn.yawRad);
  return { radius: R, passed: out.filter((r) => r.pass).length, total: out.length, outsideCount: outside.length, fails: out.filter((r) => !r.pass) };
})();
