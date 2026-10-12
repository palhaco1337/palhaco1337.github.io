// RED vs BLU battle: all nine classes fighting, dying and respawning.
(function () {
  var canvas = document.getElementById('battle');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W, H, GROUND, S;

  var TEAM = [
    { name: 'RED', main: '#b8383b', dark: '#8b2a2c', light: '#ff8a7a' },
    { name: 'BLU', main: '#5885a2', dark: '#3e6280', light: '#8fd0ff' }
  ];
  var SKIN = '#e0b48a';

  var STATS = {
    scout:    { name: 'Scout',    hp: 125, speed: 2.2,  range: 110, weapon: 'scattergun' },
    soldier:  { name: 'Soldier',  hp: 200, speed: 0.8,  range: 320, weapon: 'rocket launcher' },
    pyro:     { name: 'Pyro',     hp: 175, speed: 1.3,  range: 70,  weapon: 'flamethrower' },
    demoman:  { name: 'Demoman',  hp: 175, speed: 0.9,  range: 260, weapon: 'grenade launcher' },
    heavy:    { name: 'Heavy',    hp: 300, speed: 0.55, range: 240, weapon: 'minigun' },
    engineer: { name: 'Engineer', hp: 125, speed: 1.0,  range: 110, weapon: 'shotgun' },
    medic:    { name: 'Medic',    hp: 150, speed: 1.4,  range: 0,   weapon: 'syringe' },
    sniper:   { name: 'Sniper',   hp: 125, speed: 0.9,  range: 9999, weapon: 'sniper rifle' },
    spy:      { name: 'Spy',      hp: 125, speed: 1.5,  range: 18,  weapon: 'knife' },
    sentry:   { name: 'Sentry',   hp: 150, speed: 0,    range: 230, weapon: 'sentry gun' }
  };

  var units = [], shots = [], parts = [], fx = [], feed = [];
  var score = [0, 0];

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = W < 600 ? 1.15 : W < 950 ? 1.45 : 1.8;
    GROUND = H - 14;
    for (var i = 0; i < units.length; i++) units[i].y = laneY(units[i].lane);
  }

  function laneY(l) { return GROUND - (2 - l) * 13 * S; }
  function centerY(u) { return u.y - (u.cls === 'sentry' ? 12 : 24) * S; }
  function alive(u) { return u.dead < 0; }

  function roster() {
    if (W < 600) return ['scout', 'soldier', 'heavy', 'medic', 'spy'];
    if (W < 950) return ['scout', 'soldier', 'pyro', 'demoman', 'heavy', 'medic', 'sniper'];
    return ['scout', 'soldier', 'pyro', 'demoman', 'heavy', 'engineer', 'medic', 'sniper', 'spy'];
  }

  function spawn(u) {
    var side = u.team === 0 ? -1 : 1;
    u.x = u.team === 0 ? rand(-60, -15) : W + rand(15, 60);
    u.face = -side;
    u.hp = STATS[u.cls].hp;
    u.dead = -1;
    u.cd = rand(20, 80);
    u.spin = 0;
    u.walk = rand(0, 6);
    u.flash = 0;
    u.cloak = u.cls === 'spy';
    u.cloakA = u.cloak ? 0.15 : 1;
    u.decloakT = 0;
    u.heal = null;
    u.respawnAt = 0;
  }

  function makeUnit(cls, team, i) {
    var u = { cls: cls, team: team, lane: i % 3, sentry: null };
    u.y = laneY(u.lane);
    spawn(u);
    u.x = team === 0 ? rand(20, W * 0.3) : rand(W * 0.7, W - 20);
    return u;
  }

  function init() {
    units = [];
    var r = roster();
    for (var t = 0; t < 2; t++) {
      for (var i = 0; i < r.length; i++) units.push(makeUnit(r[i], t, i + t));
    }
  }

  function targetable(u, by) {
    if (!alive(u) || u.team === by.team) return false;
    if (u.cls === 'spy' && u.cloakA < 0.5) return false;
    return true;
  }

  function nearestEnemy(u, skipSentry) {
    var best = null, bd = 1e9;
    for (var i = 0; i < units.length; i++) {
      var e = units[i];
      if (!targetable(e, u) || (skipSentry && e.cls === 'sentry')) continue;
      if (e.x < -10 || e.x > W + 10) continue;
      var d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y) * 0.5;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function moveToward(u, x, speed) {
    var dx = x - u.x;
    if (Math.abs(dx) < 1) return;
    var step = Math.min(Math.abs(dx), speed * S);
    u.x += Math.sign(dx) * step;
    u.face = Math.sign(dx);
    u.walk += speed * 0.18;
  }

  function muzzle(u) {
    return { x: u.x + u.face * 16 * S, y: u.y - 27 * S };
  }

  function fire(u, t, kind, speed, dmg, spread) {
    var m = muzzle(u);
    var dx = t.x - m.x, dy = centerY(t) - m.y;
    var a = Math.atan2(dy, dx) + (Math.random() - 0.5) * spread;
    var s = { kind: kind, x: m.x, y: m.y, vx: Math.cos(a) * speed * S, vy: Math.sin(a) * speed * S, team: u.team, owner: u, dmg: dmg, life: 120, floor: t.y };
    if (kind === 'grenade') {
      var T = Math.max(20, Math.abs(dx) / (4 * S));
      s.vx = dx / T;
      s.vy = (dy - 0.5 * 0.15 * T * T) / T;
    }
    shots.push(s);
    fx.push({ kind: 'flash', x: m.x, y: m.y, life: 1, r: kind === 'rocket' ? 9 : 5 });
  }

  function hurt(v, dmg, owner, weapon) {
    if (!alive(v)) return;
    v.hp -= dmg;
    v.flash = 6;
    if (v.cls === 'spy' && v.cloak) { v.cloak = false; v.decloakT = 90; }
    if (v.hp <= 0) die(v, owner, weapon);
  }

  function die(v, owner, weapon) {
    v.dead = 0;
    v.hp = 0;
    v.respawnAt = 240 + rand(0, 160);
    if (owner) score[owner.team]++;
    feed.unshift({
      k: STATS[owner.cls].name, kt: owner.team,
      w: weapon || STATS[owner.cls].weapon,
      v: STATS[v.cls].name, vt: v.team,
      crit: weapon === 'backstab' || weapon === 'headshot', life: 300
    });
    if (feed.length > 5) feed.pop();
    var cy = centerY(v);
    var cols = [TEAM[v.team].main, TEAM[v.team].dark, SKIN, '#3a3a3a'];
    for (var i = 0; i < 16; i++) {
      parts.push({ x: v.x, y: cy, vx: rand(-3, 3), vy: rand(-5, -1), g: 0.22, life: 1, decay: rand(0.012, 0.025), r: rand(2, 4.5), c: cols[i % cols.length], floor: v.y });
    }
    smoke(v.x, cy, 6, 10);
    if (v.cls === 'sentry') {
      explosionFx(v.x, cy, 1.2);
      for (var j = 0; j < units.length; j++) if (units[j].sentry === v) units[j].sentry = null;
    }
  }

  function smoke(x, y, n, r) {
    for (var i = 0; i < n; i++) {
      parts.push({ x: x, y: y, vx: rand(-0.8, 0.8), vy: rand(-1, -0.2), g: 0, life: 1, decay: rand(0.015, 0.03), r: rand(r * 0.5, r), c: 'smoke', grow: 0.35 });
    }
  }

  function explosionFx(x, y, k) {
    for (var i = 0; i < 22 * k; i++) {
      var a = Math.random() * Math.PI * 2, s = rand(1, 4.5) * k;
      parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.06, life: 1, decay: rand(0.03, 0.05), r: rand(1.5, 3), c: 'spark' });
    }
    smoke(x, y, 8 * k, 12 * k);
    fx.push({ kind: 'ring', x: x, y: y, r: 6, life: 1 });
    fx.push({ kind: 'flash', x: x, y: y, life: 1, r: 22 * k });
  }

  function explode(s, radius) {
    explosionFx(s.x, s.y, 1);
    for (var i = 0; i < units.length; i++) {
      var e = units[i];
      if (!alive(e) || e.team === s.team) continue;
      var d = Math.hypot(e.x - s.x, centerY(e) - s.y);
      if (d < radius * S) hurt(e, s.dmg * (1 - (d / (radius * S)) * 0.5), s.owner, STATS[s.owner.cls].weapon);
    }
  }

  // ---------- behaviour ----------

  function updateUnit(u) {
    if (u.flash > 0) u.flash--;
    if (u.cd > 0) u.cd--;
    var st = STATS[u.cls];

    if (u.cls === 'sentry') {
      if (u.build < 1) { u.build = Math.min(1, u.build + 0.008); u.hp = Math.max(u.hp, st.hp * u.build); return; }
      var ts = nearestEnemy(u);
      if (ts && Math.abs(ts.x - u.x) < st.range * S) {
        u.face = Math.sign(ts.x - u.x) || u.face;
        if (u.cd <= 0) { fire(u, ts, 'bullet', 9, 3, 0.08); u.cd = 7; }
      }
      return;
    }

    if (u.cls === 'medic') {
      var best = null, br = 2;
      for (var i = 0; i < units.length; i++) {
        var a = units[i];
        if (a === u || a.team !== u.team || !alive(a) || a.cls === 'sentry' || a.cls === 'medic') continue;
        var ratio = a.hp / STATS[a.cls].hp - (a.cls === 'heavy' ? 0.15 : 0);
        if (ratio < br) { br = ratio; best = a; }
      }
      u.heal = null;
      if (best) {
        var back = best.x - (u.team === 0 ? 1 : -1) * 45 * S;
        moveToward(u, back, st.speed);
        if (Math.abs(best.x - u.x) < 110 * S) {
          u.heal = best;
          u.face = Math.sign(best.x - u.x) || u.face;
          best.hp = Math.min(STATS[best.cls].hp * 1.2, best.hp + 0.9);
        }
      }
      return;
    }

    if (u.cls === 'spy') {
      if (u.decloakT > 0) { u.decloakT--; if (u.decloakT === 0) u.cloak = true; }
      u.cloakA += ((u.cloak ? 0.12 : 1) - u.cloakA) * 0.08;
      var tv = nearestEnemy(u, true);
      if (!tv) { moveToward(u, W / 2, st.speed); return; }
      var dxs = tv.x - u.x;
      if (Math.abs(dxs) > 14 * S || Math.abs(tv.y - u.y) > 20 * S) {
        moveToward(u, tv.x - Math.sign(dxs) * 10 * S, st.speed);
      } else if (u.cd <= 0) {
        u.cloak = false;
        u.decloakT = 120;
        u.cd = 100;
        hurt(tv, 9999, u, 'backstab');
      }
      return;
    }

    if (u.cls === 'engineer') {
      var dirE = u.team === 0 ? 1 : -1;
      var buildX = u.team === 0 ? W * 0.18 : W * 0.82;
      if (!u.sentry) {
        moveToward(u, buildX, st.speed);
        if (Math.abs(u.x - buildX) < 2) {
          u.sentry = { cls: 'sentry', team: u.team, lane: u.lane, y: u.y, x: buildX + dirE * 22 * S, face: dirE, hp: 1, dead: -1, cd: 0, build: 0, flash: 0 };
          units.push(u.sentry);
        }
        return;
      }
      moveToward(u, u.sentry.x - dirE * 22 * S, st.speed);
      if (alive(u.sentry) && u.sentry.hp < STATS.sentry.hp && Math.abs(u.x - u.sentry.x) < 40 * S) {
        u.sentry.hp = Math.min(STATS.sentry.hp, u.sentry.hp + 0.35);
      }
      var te = nearestEnemy(u);
      if (te && Math.abs(te.x - u.x) < st.range * S) {
        u.face = Math.sign(te.x - u.x) || u.face;
        if (u.cd <= 0) { for (var p = 0; p < 5; p++) fire(u, te, 'bullet', 8, 6, 0.3); u.cd = 55; }
      }
      return;
    }

    if (u.cls === 'sniper') {
      var home = u.team === 0 ? 30 * S : W - 30 * S;
      moveToward(u, home, st.speed);
      var tn = nearestEnemy(u);
      u.aim = tn;
      if (tn && Math.abs(u.x - home) < 4) {
        u.face = Math.sign(tn.x - u.x) || u.face;
        if (u.cd <= 0) {
          var head = Math.random() < 0.35;
          var m = muzzle(u);
          fx.push({ kind: 'tracer', x1: m.x, y1: m.y, x2: tn.x, y2: tn.y - (head ? 40 : 24) * S, life: 1 });
          hurt(tn, head ? 150 : 50, u, head ? 'headshot' : 'sniper rifle');
          u.cd = 150;
        }
      }
      return;
    }

    var t = nearestEnemy(u);
    if (!t) { moveToward(u, W / 2 + (u.team === 0 ? -40 : 40), st.speed); return; }
    var dist = Math.abs(t.x - u.x);
    var inRange = dist < st.range * S;

    if (u.cls === 'heavy') {
      u.spin = inRange ? Math.min(u.spin + 1, 40) : Math.max(u.spin - 1, 0);
      if (dist > st.range * 0.7 * S) moveToward(u, t.x, st.speed * (u.spin > 0 ? 0.5 : 1));
      else u.face = Math.sign(t.x - u.x) || u.face;
      if (u.spin >= 30 && u.cd <= 0) { fire(u, t, 'bullet', 9, 2.2, 0.15); u.cd = 4; }
      return;
    }

    if (u.cls === 'pyro') {
      if (dist > 50 * S) moveToward(u, t.x, st.speed);
      else u.face = Math.sign(t.x - u.x) || u.face;
      if (dist < 110 * S) {
        var m2 = muzzle(u);
        for (var f = 0; f < 2; f++) {
          parts.push({ x: m2.x, y: m2.y, vx: u.face * rand(3, 5) * S, vy: rand(-0.8, 0.4), g: -0.03, life: 1, decay: rand(0.05, 0.08), r: rand(3, 6), c: 'fire', grow: 0.25 });
        }
        for (var k = 0; k < units.length; k++) {
          var e = units[k];
          if (!alive(e) || e.team === u.team) continue;
          var ddx = (e.x - u.x) * u.face;
          if (ddx > 0 && ddx < st.range * S && Math.abs(e.y - u.y) < 30 * S) hurt(e, 0.9, u, 'flamethrower');
        }
      }
      return;
    }

    // scout, soldier, demoman
    if (dist > st.range * 0.85 * S) moveToward(u, t.x, st.speed);
    else {
      u.face = Math.sign(t.x - u.x) || u.face;
      if (u.cls === 'scout') { u.x += Math.sin(u.walk * 0.7) * 1.5; u.walk += 0.3; }
    }
    if (inRange && u.cd <= 0) {
      if (u.cls === 'scout') { for (var q = 0; q < 6; q++) fire(u, t, 'bullet', 9, 7, 0.35); u.cd = 45; }
      if (u.cls === 'soldier') { fire(u, t, 'rocket', 4.5, 60, 0.05); u.cd = 80; }
      if (u.cls === 'demoman') { fire(u, t, 'grenade', 0, 60, 0); u.cd = 70; }
    }
  }

  function updateShots() {
    for (var i = shots.length - 1; i >= 0; i--) {
      var s = shots[i];
      s.life--;
      if (s.kind === 'grenade') s.vy += 0.15;
      s.x += s.vx;
      s.y += s.vy;
      if (s.kind === 'rocket' && s.life % 2 === 0) parts.push({ x: s.x, y: s.y, vx: 0, vy: -0.2, g: 0, life: 0.8, decay: 0.03, r: 2.5, c: 'smoke', grow: 0.25 });

      var hit = null;
      for (var j = 0; j < units.length; j++) {
        var e = units[j];
        if (!alive(e) || e.team === s.team) continue;
        if (Math.abs(e.x - s.x) < 9 * S && Math.abs(centerY(e) - s.y) < 18 * S) { hit = e; break; }
      }

      var landed = s.kind === 'grenade' && s.vy > 0 && s.y >= s.floor - 2;
      var out = s.life <= 0 || s.x < -50 || s.x > W + 50 || s.y > H + 20;

      if (s.kind === 'bullet') {
        if (hit) hurt(hit, s.dmg, s.owner, STATS[s.owner.cls].weapon);
        if (hit || out) shots.splice(i, 1);
      } else if (hit || landed || out) {
        if (!out || s.life <= 0) explode(s, 48);
        shots.splice(i, 1);
      }
    }
  }

  function update() {
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (alive(u)) updateUnit(u);
      else {
        u.dead++;
        if (u.cls === 'sentry') { if (u.dead > 60) { units.splice(i, 1); i--; } }
        else if (u.dead > u.respawnAt) spawn(u);
      }
    }
    updateShots();

    for (var p = parts.length - 1; p >= 0; p--) {
      var q = parts[p];
      q.vy += q.g;
      q.x += q.vx;
      q.y += q.vy;
      if (q.floor && q.y > q.floor) { q.y = q.floor; q.vy *= -0.3; q.vx *= 0.7; }
      if (q.grow) q.r += q.grow;
      q.life -= q.decay;
      if (q.life <= 0) parts.splice(p, 1);
    }
    for (var f = fx.length - 1; f >= 0; f--) {
      var x = fx[f];
      x.life -= x.kind === 'tracer' ? 0.06 : x.kind === 'ring' ? 0.06 : 0.2;
      if (x.kind === 'ring') x.r += 3.5;
      if (x.life <= 0) fx.splice(f, 1);
    }
    for (var k = feed.length - 1; k >= 0; k--) if (--feed[k].life <= 0) feed.splice(k, 1);
  }

  // ---------- drawing ----------

  function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function C(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function L(x1, y1, x2, y2, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function cap(y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, y, r, Math.PI, 0); ctx.fill(); }

  function legs(p, pants, wide) {
    var o = wide || 3;
    L(-o, -18, -o + p, -2, wide ? 7 : 5, pants);
    L(o, -18, o - p, -2, wide ? 7 : 5, pants);
    R(-o + p - 3, -3, 7, 3, '#2b2118');
    R(o - p - 3, -3, 7, 3, '#2b2118');
  }

  var DRAW = {
    scout: function (tm, p) {
      legs(p, '#c9b48a');
      R(-6, -34, 12, 17, tm.main);
      C(0, -40, 6, SKIN);
      cap(-41, 6.5, tm.main); R(2, -42, 8, 2, tm.dark);
      C(-1, -40, 2, '#333');
      R(0, -28, 6, 4, '#6b4a2e'); R(4, -29, 15, 3, '#3a3a3a');
      L(0, -31, 8, -27, 4, tm.main); C(8, -27, 2.5, SKIN);
    },
    soldier: function (tm, p) {
      legs(p, '#5b4a36');
      R(-7.5, -34, 15, 17, tm.main);
      L(-6, -33, 6, -19, 2.5, '#4a3a28');
      C(0, -40, 6, SKIN); R(1, -38, 4, 2.5, '#4a1c16');
      cap(-42, 8, '#5c5236'); R(-9, -43, 18, 3, '#4a4229');
      ctx.save(); ctx.translate(0, -33); ctx.rotate(-0.12);
      R(-12, -4, 30, 7, '#4f5b3b'); R(-14, -5, 4, 9, '#3a4229'); R(16, -5, 5, 9, '#3a4229');
      ctx.restore();
      L(2, -30, 8, -32, 4, tm.main); C(8, -32, 2.5, SKIN);
    },
    pyro: function (tm, p) {
      C(-8, -28, 4.5, '#7a7a7a');
      legs(p, tm.dark);
      R(-7.5, -35, 15, 18, tm.main); R(-7.5, -22, 15, 2, '#3a2c1e');
      C(0, -41, 6.5, '#5e5e5e'); C(3, -42, 2.6, '#1a1a1a'); C(4, -37, 2.5, '#3a3a3a');
      R(2, -29, 20, 4, '#8a8a8a'); R(20, -30, 4, 6, '#555');
      L(0, -31, 6, -27, 4, tm.main);
    },
    demoman: function (tm, p) {
      legs(p, '#3a3a3a');
      R(-7.5, -34, 15, 17, tm.main);
      L(-6, -33, 6, -19, 2.5, '#3a2c1e');
      C(0, -40, 6, '#6b4a32');
      cap(-41, 6.5, '#2b2b2b');
      L(-5, -43, 6, -40, 1.5, '#111'); C(3, -40, 1.6, '#111');
      R(3, -30, 16, 5, '#5a3c22'); C(7, -27, 4, '#3a3a3a');
      L(0, -31, 6, -27, 4, tm.main);
    },
    heavy: function (tm, p, u) {
      legs(p * 0.6, '#4b4b5a', 5);
      R(-12, -40, 24, 24, tm.main);
      L(-10, -39, 9, -18, 3, '#3a2c1e');
      C(1, -45, 6.5, SKIN); R(4, -42, 4, 2, '#7a4a32');
      R(0, -33, 9, 13, '#555');
      R(6, -31, 24, 8, '#3a3a3a');
      var sp = u && u.spin ? (u.spin * 0.6) % 3 : 0;
      L(10, -29 + sp, 30, -29 + sp, 1.5, '#888');
      L(10, -26 + sp * 0.5, 30, -26 + sp * 0.5, 1.5, '#888');
      C(4, -27, 3.5, SKIN);
    },
    engineer: function (tm, p) {
      legs(p, '#5b4a36');
      R(-7, -34, 14, 17, tm.main);
      C(0, -40, 6, SKIN);
      cap(-42, 7, '#e8b830'); R(-8, -43, 16, 2, '#c99a20');
      R(0, -41.5, 6, 2.5, '#333');
      R(4, -29, 14, 3, '#3a3a3a'); R(1, -28, 6, 4, '#6b4a2e');
      L(0, -31, 7, -27, 4, tm.main); C(8, -27, 3, '#c9b48a');
    },
    medic: function (tm, p) {
      R(-12, -34, 6, 12, tm.dark);
      legs(p, '#3a3a3a');
      R(-7, -35, 14, 24, '#e8e6df');
      L(1, -34, 1, -25, 2, tm.main);
      C(0, -41, 6, SKIN);
      cap(-42, 6.3, '#3a3a3a');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(3.5, -41, 1.8, 0, Math.PI * 2); ctx.stroke();
      R(4, -29, 10, 4, '#9a9a9a'); C(14, -27, 2, tm.light);
      L(0, -31, 6, -27, 4, '#e8e6df');
    },
    sniper: function (tm, p) {
      legs(p, '#5b4a36');
      R(-6, -34, 12, 17, tm.main); R(-6, -34, 5, 17, '#4a3a28');
      C(0, -40, 6, SKIN);
      R(-10, -45, 20, 2, '#6b4a2e'); cap(-45, 5, '#6b4a2e'); R(-5, -46, 10, 1.5, '#3a2c1e');
      R(0, -29, 32, 2.5, '#4a3a28'); R(7, -32, 9, 2.5, '#222');
      L(0, -31, 6, -28, 4, tm.main);
    },
    spy: function (tm, p) {
      legs(p, tm.dark);
      R(-6, -34, 12, 17, tm.dark);
      L(1, -34, 1, -27, 2, '#eee');
      C(0, -40, 6, tm.main);
      R(1, -42, 5, 2, SKIN); R(2, -38, 4, 2, SKIN);
      L(5, -37, 9, -37, 1.5, '#fff'); C(9.5, -37, 1, '#ff8a3a');
      L(0, -31, 6, -27, 3.5, tm.dark); L(6, -27, 13, -28, 1.5, '#cfd8dc');
    },
    sentry: function (tm, p, u) {
      ctx.save();
      ctx.scale(1, Math.max(0.2, u.build));
      L(0, -6, -8, 0, 2, '#555'); L(0, -6, 8, 0, 2, '#555'); L(0, -6, 0, 0, 2, '#555');
      R(-7, -18, 14, 12, tm.main); R(-7, -18, 14, 3, tm.dark);
      R(-3, -23, 12, 8, '#6a6a6a'); R(8, -21, 9, 3, '#333');
      ctx.restore();
    }
  };

  function drawUnit(u) {
    var tm = TEAM[u.team];
    var alpha = 1, rot = 0;
    if (!alive(u)) {
      rot = -Math.min(u.dead / 14, 1) * Math.PI / 2;
      alpha = Math.max(0, 1 - Math.max(0, u.dead - 80) / 60);
      if (alpha <= 0) return;
    }
    if (u.cls === 'spy') alpha *= u.cloakA;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(u.x + (u.flash > 0 ? rand(-1.5, 1.5) : 0), u.y);
    ctx.scale(u.face * S, S);
    ctx.rotate(rot);
    ctx.lineCap = 'round';
    var p = alive(u) ? Math.sin(u.walk) * 4 : 0;
    DRAW[u.cls](tm, p, u);
    ctx.restore();

    if (alive(u) && u.hp < STATS[u.cls].hp && u.cls !== 'spy') {
      var w = 22 * S, top = u.y - (u.cls === 'sentry' ? 30 : u.cls === 'heavy' ? 58 : 54) * S;
      R(u.x - w / 2, top, w, 3, 'rgba(0,0,0,0.6)');
      R(u.x - w / 2, top, w * Math.max(0, Math.min(1, u.hp / STATS[u.cls].hp)), 3, u.hp / STATS[u.cls].hp < 0.35 ? '#ff5a3a' : '#d6f0a0');
    }
  }

  function drawBeams() {
    for (var i = 0; i < units.length; i++) {
      var u = units[i];
      if (!alive(u)) continue;
      if (u.cls === 'medic' && u.heal && alive(u.heal)) {
        var m = muzzle(u), t = u.heal, ty = centerY(t);
        ctx.strokeStyle = TEAM[u.team].light;
        ctx.globalAlpha = 0.55 + Math.random() * 0.25;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.quadraticCurveTo((m.x + t.x) / 2, Math.min(m.y, ty) - 18 * S, t.x, ty);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (u.cls === 'sniper' && u.aim && alive(u.aim)) {
        var ms = muzzle(u);
        ctx.strokeStyle = TEAM[u.team].main;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(ms.x, ms.y); ctx.lineTo(u.aim.x, u.aim.y - 34 * S); ctx.stroke();
        C(u.aim.x, u.aim.y - 34 * S, 2.5, TEAM[u.team].light);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawShots() {
    for (var i = 0; i < shots.length; i++) {
      var s = shots[i];
      if (s.kind === 'bullet') {
        L(s.x, s.y, s.x - s.vx * 1.5, s.y - s.vy * 1.5, 1.5, '#ffe9a0');
      } else if (s.kind === 'rocket') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(Math.atan2(s.vy, s.vx));
        ctx.fillStyle = 'rgba(255,170,40,0.9)';
        ctx.beginPath(); ctx.moveTo(-6, -2.5); ctx.lineTo(-14 - Math.random() * 6, 0); ctx.lineTo(-6, 2.5); ctx.fill();
        R(-6, -2.5, 10, 5, '#6b6f5a');
        ctx.fillStyle = TEAM[s.team].main;
        ctx.beginPath(); ctx.moveTo(4, -2.5); ctx.lineTo(8, 0); ctx.lineTo(4, 2.5); ctx.fill();
        ctx.restore();
      } else {
        C(s.x, s.y, 3.5, '#2f2f2f');
        C(s.x - 1, s.y - 1, 1.2, TEAM[s.team].main);
      }
    }
  }

  function drawParts() {
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      if (q.c === 'smoke') ctx.fillStyle = 'rgba(200,190,175,' + q.life * 0.35 + ')';
      else if (q.c === 'spark') ctx.fillStyle = q.life > 0.5 ? 'rgba(255,240,170,' + q.life + ')' : 'rgba(230,110,40,' + q.life + ')';
      else if (q.c === 'fire') ctx.fillStyle = q.life > 0.6 ? 'rgba(255,220,120,' + q.life + ')' : 'rgba(235,95,30,' + q.life + ')';
      else { ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillStyle = q.c; }
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawFx() {
    for (var i = 0; i < fx.length; i++) {
      var x = fx[i];
      if (x.kind === 'flash') C(x.x, x.y, x.r * x.life + 2, 'rgba(255,230,140,' + x.life + ')');
      if (x.kind === 'ring') {
        ctx.strokeStyle = 'rgba(255,220,150,' + x.life + ')';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x.x, x.y, x.r, 0, Math.PI * 2); ctx.stroke();
      }
      if (x.kind === 'tracer') L(x.x1, x.y1, x.x2, x.y2, 2, 'rgba(255,255,230,' + x.life + ')');
    }
  }

  function drawHud() {
    ctx.textBaseline = 'middle';
    ctx.font = '22px Anton, Impact, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = TEAM[0].main;
    ctx.fillText('RED ' + score[0], 12, 20);
    var rw = ctx.measureText('RED ' + score[0]).width;
    ctx.fillStyle = '#ebe3cb';
    ctx.fillText(' : ', 12 + rw, 20);
    var cw = ctx.measureText(' : ').width;
    ctx.fillStyle = TEAM[1].main;
    ctx.fillText(score[1] + ' BLU', 12 + rw + cw, 20);

    ctx.font = '12px Lato, Verdana, sans-serif';
    var y = 16;
    var maxRows = W < 600 ? 3 : 5;
    for (var i = 0; i < feed.length && i < maxRows; i++) {
      var f = feed[i];
      var parts2 = [[f.k, TEAM[f.kt].light], ['  ' + f.w + '  ', f.crit ? '#ffd700' : '#a49d89'], [f.v, TEAM[f.vt].light]];
      var tw = 0;
      for (var j = 0; j < 3; j++) tw += ctx.measureText(parts2[j][0]).width;
      var x = W - 10 - tw - 16;
      ctx.globalAlpha = Math.min(1, f.life / 30);
      ctx.fillStyle = 'rgba(28,25,22,0.85)';
      ctx.fillRect(x, y - 10, tw + 16, 20);
      ctx.strokeStyle = f.crit ? 'rgba(255,215,0,0.6)' : 'rgba(235,227,203,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y - 9.5, tw + 15, 19);
      var cx = x + 8;
      for (var k = 0; k < 3; k++) {
        ctx.fillStyle = parts2[k][1];
        ctx.fillText(parts2[k][0], cx, y);
        cx += ctx.measureText(parts2[k][0]).width;
      }
      ctx.globalAlpha = 1;
      y += 24;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var g = ctx.createLinearGradient(0, GROUND - 40 * S, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND - 40 * S, W, H);

    var order = units.slice().sort(function (a, b) { return a.y - b.y; });
    drawBeams();
    for (var i = 0; i < order.length; i++) drawUnit(order[i]);
    drawShots();
    drawParts();
    drawFx();
    drawHud();
  }

  // ---------- loop ----------

  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; }).observe(canvas);
  }

  function loop() {
    if (visible && !document.hidden) { update(); draw(); }
    requestAnimationFrame(loop);
  }

  resize();
  init();
  window.addEventListener('resize', resize);

  if (reduce) {
    for (var i = 0; i < 400; i++) update();
    draw();
    return;
  }
  requestAnimationFrame(loop);
})();
