// "Play Survive": 30-second rocket target practice as the Soldier.
(function () {
  var modal = document.getElementById('game');
  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');
  var startCard = document.getElementById('game-start');
  var endCard = document.getElementById('game-end');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var DURATION = 30;
  var RED = '#b8383b', BLU = '#5885a2', BLU_DARK = '#3e6280', SKIN = '#e0b48a', TAN = '#ebe3cb';

  var W, H, GROUND, S;
  var state = 'idle', raf = 0, last = 0, startTime = 0, timeLeft = DURATION;
  var aim = { x: 0, y: 0 }, firing = false, cooldown = 0;
  var rockets, targets, parts, texts, spawnIn;
  var score, combo, shots, hits, best;
  var intel = null;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.max(1.4, Math.min(2.4, Math.min(W, H) / 330));
    GROUND = H - 24;
  }

  function soldierPos() { return { x: Math.max(50, W * 0.08), y: GROUND }; }

  function aimAngle() {
    var p = soldierPos();
    var sx = p.x, sy = p.y - 33 * S;
    var face = aim.x >= sx ? 1 : -1;
    var a = Math.atan2(aim.y - sy, (aim.x - sx) * face);
    a = Math.max(-1.45, Math.min(0.5, a));
    return { a: a, face: face, sx: sx, sy: sy };
  }

  function muzzle() {
    var g = aimAngle();
    var len = 22 * S;
    return { x: g.sx + g.face * Math.cos(g.a) * len, y: g.sy + Math.sin(g.a) * len, vx: g.face * Math.cos(g.a), vy: Math.sin(g.a) };
  }

  // ---------- game flow ----------

  function open() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    resize();
    reset();
    state = 'idle';
    startCard.hidden = false;
    endCard.hidden = true;
    loopStart();
    document.getElementById('game-go').focus();
  }

  function close() {
    state = 'idle';
    modal.hidden = true;
    document.body.style.overflow = '';
    cancelAnimationFrame(raf);
    raf = 0;
    document.getElementById('play-btn').focus();
  }

  function reset() {
    rockets = []; targets = []; parts = []; texts = [];
    spawnIn = 0.4;
    score = 0; combo = 0; shots = 0; hits = 0; best = 0;
    timeLeft = DURATION;
    cooldown = 0;
    firing = false;
    aim.x = W * 0.6; aim.y = H * 0.4;
  }

  function start() {
    reset();
    startCard.hidden = true;
    endCard.hidden = true;
    state = 'play';
    startTime = performance.now();
    canvas.focus();
  }

  function finish() {
    state = 'end';
    firing = false;
    document.getElementById('end-score').textContent = score;
    var acc = shots ? Math.round(hits / shots * 100) : 0;
    document.getElementById('end-stats').textContent =
      hits + ' targets hit · ' + shots + ' rockets · accuracy ' + acc + '% · best combo x' + Math.max(1, best);
    endCard.hidden = false;
    locate();
    document.getElementById('game-again').focus();
  }

  // ---------- IP / location dossier ----------

  var leafletMap = null, mapLayers = [];

  function rows(el, list) {
    el.textContent = '';
    for (var i = 0; i < list.length; i++) {
      if (list[i][1] === undefined || list[i][1] === null || list[i][1] === '') continue;
      var dt = document.createElement('dt');
      var dd = document.createElement('dd');
      dt.textContent = list[i][0];
      dd.textContent = String(list[i][1]);
      el.appendChild(dt);
      el.appendChild(dd);
    }
  }

  function showIntel(d) {
    var ip = document.getElementById('intel-ip');
    var loc = document.getElementById('intel-loc');
    var flag = document.getElementById('intel-flag');
    if (!d) {
      ip.textContent = 'Could not locate you.';
      loc.textContent = 'The location service may be blocked (ad-block) or down.';
      flag.hidden = true;
      document.getElementById('map-note').textContent = 'No location, no map.';
      rows(document.getElementById('intel-whois'), [['Status', 'No IP to look up.']]);
      showConnection(null);
      return;
    }
    ip.textContent = 'IP: ' + d.ip;
    loc.textContent = [d.city, d.region, d.country].filter(Boolean).join(', ');
    if (d.cc) {
      flag.src = 'https://flagcdn.com/w160/' + d.cc.toLowerCase() + '.png';
      flag.alt = 'Flag: ' + (d.country || d.cc);
      flag.hidden = false;
    } else {
      flag.hidden = true;
    }
    showMap(d);
    showConnection(d);
    whois(d);
  }

  function locate() {
    if (intel) { showIntel(intel); return; }
    document.getElementById('intel-ip').textContent = 'Locating...';
    document.getElementById('intel-loc').textContent = '';
    document.getElementById('intel-flag').hidden = true;

    fetch('https://ipwho.is/')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.success === false) throw new Error('ipwho.is failed');
        var c = j.connection || {}, tz = j.timezone || {};
        return {
          ip: j.ip, type: j.type, city: j.city, region: j.region, country: j.country, cc: j.country_code,
          continent: j.continent, lat: j.latitude, lon: j.longitude, postal: j.postal, calling: j.calling_code,
          isp: c.isp, org: c.org, asn: c.asn, domain: c.domain, tz: tz.id, utc: tz.utc
        };
      })
      .catch(function () {
        return fetch('https://ipapi.co/json/')
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || j.error) throw new Error('ipapi.co failed');
            return {
              ip: j.ip, type: j.version, city: j.city, region: j.region, country: j.country_name, cc: j.country_code,
              continent: j.continent_code, lat: j.latitude, lon: j.longitude, postal: j.postal, calling: j.country_calling_code,
              isp: j.org, org: j.org, asn: j.asn, tz: j.timezone, utc: j.utc_offset
            };
          });
      })
      .then(function (d) { intel = d; showIntel(d); })
      .catch(function () { showIntel(null); });
  }

  // --- TF2-style map ---

  function loadLeaflet(cb, fail) {
    if (window.L) { cb(); return; }
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
    document.head.appendChild(css);
    var js = document.createElement('script');
    js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    js.onload = cb;
    js.onerror = fail;
    document.head.appendChild(js);
  }

  var BRIEFCASE =
    '<svg viewBox="0 0 48 40" width="42" height="35" aria-hidden="true">' +
    '<rect x="16" y="2" width="16" height="8" rx="2" fill="none" stroke="#3a2c1e" stroke-width="3"/>' +
    '<rect x="2" y="8" width="44" height="30" rx="4" fill="#b8383b" stroke="#3a2c1e" stroke-width="3"/>' +
    '<rect x="2" y="18" width="44" height="4" fill="#8b2a2c"/>' +
    '<rect x="20" y="16" width="8" height="8" rx="1" fill="#d6b25a" stroke="#3a2c1e" stroke-width="1.5"/>' +
    '</svg>';

  function showMap(d) {
    var note = document.getElementById('map-note');
    if (typeof d.lat !== 'number' || typeof d.lon !== 'number') { note.textContent = 'Coordinates unavailable.'; return; }
    loadLeaflet(function () {
      var L = window.L;
      var pos = [d.lat, d.lon];
      if (!leafletMap) {
        leafletMap = L.map('intel-map', { scrollWheelZoom: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 16,
          attribution: '&copy; OpenStreetMap'
        }).addTo(leafletMap);
      }
      for (var i = 0; i < mapLayers.length; i++) leafletMap.removeLayer(mapLayers[i]);
      leafletMap.setView(pos, 10);
      mapLayers = [
        L.circle(pos, { radius: 15000, color: '#b8383b', weight: 3, dashArray: '8 6', fillColor: '#b8383b', fillOpacity: 0.15 }).addTo(leafletMap),
        L.marker(pos, { icon: L.divIcon({ className: 'intel-marker', html: BRIEFCASE, iconSize: [42, 35], iconAnchor: [21, 18] }) })
          .addTo(leafletMap)
          .bindTooltip('RED intelligence: ' + [d.city, d.country].filter(Boolean).join(', '), { direction: 'top', offset: [0, -16] })
      ];
      setTimeout(function () { leafletMap.invalidateSize(); }, 50);
    }, function () {
      note.textContent = 'Could not load the map.';
    });
  }

  // --- WHOIS via RDAP ---

  function vcard(ent, key) {
    var v = ent && ent.vcardArray && ent.vcardArray[1];
    if (!v) return '';
    for (var i = 0; i < v.length; i++) if (v[i][0] === key) return v[i][3];
    return '';
  }

  function flatEntities(list, out) {
    out = out || [];
    for (var i = 0; list && i < list.length; i++) {
      out.push(list[i]);
      flatEntities(list[i].entities, out);
    }
    return out;
  }

  function eventDate(obj, action) {
    var ev = obj.events || [];
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].eventAction === action) return new Date(ev[i].eventDate).toLocaleDateString('en-US');
    }
    return '';
  }

  function registryName(url) {
    var h = '';
    try { h = new URL(url).hostname; } catch (e) { return ''; }
    if (h.indexOf('registro.br') >= 0) return 'Registro.br (NIC.br)';
    if (h.indexOf('lacnic') >= 0) return 'LACNIC';
    if (h.indexOf('arin') >= 0) return 'ARIN';
    if (h.indexOf('ripe') >= 0) return 'RIPE NCC';
    if (h.indexOf('apnic') >= 0) return 'APNIC';
    if (h.indexOf('afrinic') >= 0) return 'AFRINIC';
    return h;
  }

  function whois(d) {
    var el = document.getElementById('intel-whois');
    rows(el, [['Status', 'Querying RDAP...']]);
    var finalUrl = '';
    if (!/^[0-9a-fA-F:.]+$/.test(d.ip)) { rows(el, [['Status', 'Invalid IP for lookup.']]); return; }
    fetch('https://rdap.org/ip/' + d.ip)
      .then(function (r) { finalUrl = r.url; if (!r.ok) throw new Error('rdap ' + r.status); return r.json(); })
      .then(function (j) {
        var ents = flatEntities(j.entities);
        var owner = '', doc = '', abuse = '', tech = '';
        for (var i = 0; i < ents.length; i++) {
          var roles = ents[i].roles || [];
          if (!owner && roles.indexOf('registrant') >= 0) {
            owner = vcard(ents[i], 'fn');
            var ids = ents[i].publicIds || [];
            if (ids.length) doc = String(ids[0].type).toUpperCase() + ' ' + ids[0].identifier;
          }
          if (!abuse && roles.indexOf('abuse') >= 0) abuse = vcard(ents[i], 'email') || vcard(ents[i], 'fn');
          if (!tech && roles.indexOf('technical') >= 0) tech = vcard(ents[i], 'email') || vcard(ents[i], 'fn');
        }
        var block = j.handle && j.handle.indexOf('/') > 0 ? j.handle
          : (j.startAddress && j.endAddress ? j.startAddress + ' – ' + j.endAddress : j.handle);
        rows(el, [
          ['Block', block],
          ['Network name', j.name],
          ['Type', j.type],
          ['Block owner', owner],
          ['Document', doc],
          ['ASN', j.nicbr_autnum ? 'AS' + j.nicbr_autnum : (d.asn ? 'AS' + String(d.asn).replace(/^AS/i, '') : '')],
          ['Country', j.country],
          ['Registered on', eventDate(j, 'registration')],
          ['Last changed', eventDate(j, 'last changed')],
          ['Abuse contact', abuse],
          ['Technical contact', tech],
          ['Registry (RIR/NIR)', registryName(finalUrl)]
        ]);
      })
      .catch(function () {
        rows(el, [['Status', 'Could not query RDAP right now.']]);
      });
  }

  // --- connection + browser ---

  function browserName(ua) {
    var m;
    if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1];
    if ((m = ua.match(/OPR\/(\d+)/))) return 'Opera ' + m[1];
    if ((m = ua.match(/Firefox\/(\d+)/))) return 'Firefox ' + m[1];
    if ((m = ua.match(/Chrome\/(\d+)/))) return 'Chrome ' + m[1];
    if ((m = ua.match(/Version\/([\d.]+).*Safari/))) return 'Safari ' + m[1];
    return 'Unknown';
  }

  function osName(ua) {
    var m;
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if ((m = ua.match(/Windows NT ([\d.]+)/))) return 'Windows NT ' + m[1];
    if ((m = ua.match(/Android ([\d.]+)/))) return 'Android ' + m[1];
    if ((m = ua.match(/(?:iPhone|CPU) OS ([\d_]+)/))) return 'iOS ' + m[1].replace(/_/g, '.');
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  function showConnection(d) {
    var ua = navigator.userAgent || '';
    var net = navigator.connection || {};
    var list = [];
    if (d) {
      list.push(
        ['IP type', d.type],
        ['Provider (ISP)', d.isp],
        ['Organization', d.org !== d.isp ? d.org : ''],
        ['ASN', d.asn ? 'AS' + String(d.asn).replace(/^AS/i, '') : ''],
        ['Provider domain', d.domain],
        ['Approx. coordinates', typeof d.lat === 'number' ? d.lat.toFixed(2) + ', ' + d.lon.toFixed(2) : ''],
        ['Approx. postal code', d.postal],
        ['Continent', d.continent],
        ['Calling code', d.calling ? '+' + String(d.calling).replace(/^\+/, '') : ''],
        ['Time zone (by IP)', d.tz ? d.tz + (d.utc ? ' (UTC' + d.utc + ')' : '') : '']
      );
    }
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    list.push(
      ['Browser', browserName(ua)],
      ['System', osName(ua)],
      ['Language', (navigator.languages || [navigator.language]).join(', ')],
      ['Screen', screen.width + ' × ' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x'],
      ['Window', window.innerWidth + ' × ' + window.innerHeight],
      ['CPU cores', navigator.hardwareConcurrency],
      ['Memory (approx.)', navigator.deviceMemory ? navigator.deviceMemory + ' GB' : ''],
      ['Network (estimated)', net.effectiveType ? net.effectiveType.toUpperCase() + (net.downlink ? ' · ~' + net.downlink + ' Mbps' : '') : ''],
      ['Touchscreen', navigator.maxTouchPoints > 0 ? 'Yes (' + navigator.maxTouchPoints + ' points)' : 'No'],
      ['Browser time zone', tz],
      ['Local time', new Date().toLocaleString('en-US')],
      ['Do Not Track', navigator.doNotTrack === '1' ? 'Enabled' : 'Disabled'],
      ['Cookies', navigator.cookieEnabled ? 'Enabled' : 'Blocked']
    );
    rows(document.getElementById('intel-conn'), list);
  }

  // ---------- spawning ----------

  function spawnTarget() {
    var r = Math.random();
    var fromLeft = Math.random() < 0.3;
    if (r < 0.35) {
      targets.push({ type: 'big', r: 30 * S / 1.6, pts: 10, x: fromLeft ? -40 : W + 40, y: rand(H * 0.12, H * 0.6), vx: (fromLeft ? 1 : -1) * rand(1.5, 2.6), bob: rand(0, 6), t: 0 });
    } else if (r < 0.6) {
      targets.push({ type: 'small', r: 16 * S / 1.6, pts: 25, x: fromLeft ? -30 : W + 30, y: rand(H * 0.1, H * 0.5), vx: (fromLeft ? 1 : -1) * rand(3, 4.6), bob: rand(0, 6), t: 0 });
    } else if (r < 0.85) {
      targets.push({ type: 'pop', r: 28 * S / 1.6, pts: 10, x: rand(Math.max(W * 0.3, 160), W - 50), base: GROUND, rise: 0, life: 2.6, t: 0 });
    } else {
      targets.push({ type: 'scout', r: 22 * S / 1.6, pts: 50, x: W + 30, y: GROUND, vx: -rand(3.2, 4.8), vy: 0, jumps: 0, t: 0 });
    }
  }

  function targetCenter(t) {
    if (t.type === 'pop') return { x: t.x, y: t.base - 70 * S * t.rise };
    if (t.type === 'scout') return { x: t.x, y: t.y - 26 * S };
    return { x: t.x, y: t.y + Math.sin(t.t * 0.05 + t.bob) * 14 };
  }

  // ---------- update ----------

  function fireRocket() {
    var m = muzzle();
    rockets.push({ x: m.x, y: m.y, vx: m.vx * 10, vy: m.vy * 10, hit: false });
    shots++;
    cooldown = 0.42;
    flash(m.x, m.y, 14);
    smoke(m.x, m.y, 6, 8);
  }

  function flash(x, y, r) { parts.push({ kind: 'flash', x: x, y: y, r: r, life: 1 }); }

  function smoke(x, y, n, r) {
    for (var i = 0; i < n; i++) parts.push({ kind: 'smoke', x: x, y: y, vx: rand(-0.8, 0.8), vy: rand(-1, -0.2), r: rand(r * 0.5, r), life: 1, decay: rand(0.015, 0.03) });
  }

  function explode(x, y) {
    for (var i = 0; i < 28; i++) {
      var a = Math.random() * Math.PI * 2, s = rand(1.5, 6);
      parts.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(2, 4), life: 1, decay: rand(0.025, 0.045) });
    }
    smoke(x, y, 10, 16);
    parts.push({ kind: 'ring', x: x, y: y, r: 8, life: 1 });
    flash(x, y, 34);

    var got = 0;
    for (var j = targets.length - 1; j >= 0; j--) {
      var t = targets[j], c = targetCenter(t);
      if (Math.hypot(c.x - x, c.y - y) < t.r + 42 * S / 1.6) {
        got++;
        combo++;
        best = Math.max(best, combo);
        var mult = Math.min(5, 1 + Math.floor((combo - 1) / 3));
        var pts = t.pts * mult;
        score += pts;
        hits++;
        texts.push({ x: c.x, y: c.y, s: '+' + pts + (mult > 1 ? '  x' + mult : ''), life: 1, gold: t.type === 'scout' });
        for (var k = 0; k < 10; k++) parts.push({ kind: 'chip', x: c.x, y: c.y, vx: rand(-4, 4), vy: rand(-6, -1), r: rand(2, 4), life: 1, decay: 0.02, c: t.type === 'scout' ? BLU : k % 2 ? RED : TAN });
        targets.splice(j, 1);
      }
    }
    return got;
  }

  function update(dt) {
    var k = dt * 60;

    if (state === 'play') {
      timeLeft = Math.max(0, DURATION - (performance.now() - startTime) / 1000);
      if (timeLeft <= 0) { finish(); }

      cooldown -= dt;
      if (firing && cooldown <= 0) fireRocket();

      spawnIn -= dt;
      var rate = 0.95 - (1 - timeLeft / DURATION) * 0.5;
      if (spawnIn <= 0 && targets.length < 7) { spawnTarget(); spawnIn = rate * rand(0.7, 1.3); }
    }

    for (var i = rockets.length - 1; i >= 0; i--) {
      var r = rockets[i];
      r.vx *= 1 + 0.02 * k; r.vy *= 1 + 0.02 * k;
      var sp = Math.hypot(r.vx, r.vy);
      if (sp > 20) { r.vx *= 20 / sp; r.vy *= 20 / sp; }
      r.x += r.vx * k * S / 1.6;
      r.y += r.vy * k * S / 1.6;
      parts.push({ kind: 'smoke', x: r.x - r.vx, y: r.y - r.vy, vx: 0, vy: -0.2, r: 3, life: 0.8, decay: 0.035 });

      var boom = false;
      for (var j = 0; j < targets.length; j++) {
        var c = targetCenter(targets[j]);
        if (Math.hypot(c.x - r.x, c.y - r.y) < targets[j].r + 4) { boom = true; break; }
      }
      if (!boom && r.y >= GROUND) boom = true;

      if (boom) {
        if (explode(r.x, Math.min(r.y, GROUND)) === 0) combo = 0;
        rockets.splice(i, 1);
      } else if (r.x < -40 || r.x > W + 40 || r.y < -40) {
        combo = 0;
        rockets.splice(i, 1);
      }
    }

    for (var n = targets.length - 1; n >= 0; n--) {
      var t = targets[n];
      t.t += k;
      if (t.type === 'pop') {
        t.life -= dt;
        t.rise = t.life > 0.4 ? Math.min(1, t.rise + 0.08 * k) : Math.max(0, t.rise - 0.1 * k);
        if (t.life <= 0 && t.rise <= 0) targets.splice(n, 1);
        continue;
      }
      t.x += t.vx * k;
      if (t.type === 'scout') {
        if (t.y >= GROUND && t.jumps < 2 && Math.random() < 0.012 * k) { t.vy = -rand(7, 10); t.jumps++; }
        t.vy += 0.4 * k;
        t.y = Math.min(GROUND, t.y + t.vy * k);
        if (t.y >= GROUND) t.vy = 0;
      }
      if (t.x < -80 || t.x > W + 80) targets.splice(n, 1);
    }

    for (var p = parts.length - 1; p >= 0; p--) {
      var q = parts[p];
      if (q.kind === 'flash') q.life -= 0.18 * k;
      else if (q.kind === 'ring') { q.r += 4 * k; q.life -= 0.06 * k; }
      else {
        q.x += q.vx * k; q.y += q.vy * k;
        if (q.kind === 'chip' || q.kind === 'spark') q.vy += 0.15 * k;
        if (q.kind === 'smoke') q.r += 0.3 * k;
        q.life -= q.decay * k;
      }
      if (q.life <= 0) parts.splice(p, 1);
    }

    for (var m = texts.length - 1; m >= 0; m--) {
      texts[m].y -= 0.8 * k;
      texts[m].life -= 0.02 * k;
      if (texts[m].life <= 0) texts.splice(m, 1);
    }
  }

  // ---------- drawing ----------

  function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function C(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function L(x1, y1, x2, y2, w, c) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function cap(y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, y, r, Math.PI, 0); ctx.fill(); }

  function drawSoldier() {
    var p = soldierPos(), g = aimAngle();
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(g.face * S, S);
    ctx.lineCap = 'round';
    L(-3, -18, -3, -2, 5, '#5b4a36'); L(3, -18, 3, -2, 5, '#5b4a36');
    R(-6, -3, 7, 3, '#2b2118'); R(0, -3, 7, 3, '#2b2118');
    R(-7.5, -34, 15, 17, RED);
    L(-6, -33, 6, -19, 2.5, '#4a3a28');
    C(0, -40, 6, SKIN); R(1, -38, 4, 2.5, '#4a1c16');
    cap(-42, 8, '#5c5236'); R(-9, -43, 18, 3, '#4a4229');
    ctx.save();
    ctx.translate(0, -33);
    ctx.rotate(g.a);
    var kick = cooldown > 0.3 ? -3 : 0;
    R(-12 + kick, -4, 30, 7, '#4f5b3b'); R(-14 + kick, -5, 4, 9, '#3a4229'); R(16 + kick, -5, 6, 9, '#3a4229');
    ctx.restore();
    L(2, -30, 7, -30 + Math.sin(g.a) * 6, 4, RED);
    ctx.restore();
  }

  function drawBullseye(x, y, r) {
    C(x, y + 3, r, 'rgba(0,0,0,0.3)');
    C(x, y, r, TAN);
    C(x, y, r * 0.75, RED);
    C(x, y, r * 0.5, TAN);
    C(x, y, r * 0.25, RED);
    ctx.strokeStyle = '#3a2c1e'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  }

  function drawScout(t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(-S * 1.1, S * 1.1);
    ctx.lineCap = 'round';
    var p = t.y < GROUND ? 3 : Math.sin(t.t * 0.4) * 5;
    L(-3, -18, -3 + p, -2, 5, '#c9b48a'); L(3, -18, 3 - p, -2, 5, '#c9b48a');
    R(-6, -34, 12, 17, BLU);
    C(0, -40, 6, SKIN);
    cap(-41, 6.5, BLU); R(2, -42, 8, 2, BLU_DARK);
    C(-1, -40, 2, '#333');
    R(4, -29, 15, 3, '#3a3a3a');
    L(0, -31, 8, -27, 4, BLU);
    ctx.restore();
    ctx.font = (12 * S / 1.6) + 'px Anton, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('50', t.x, t.y - 56 * S * 1.1);
  }

  function drawTargets() {
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t.type === 'scout') { drawScout(t); continue; }
      var c = targetCenter(t);
      if (t.type === 'pop') {
        if (t.rise <= 0) continue;
        L(t.x, c.y, t.x, t.base, 6 * S / 1.6, '#6b4a2e');
      }
      drawBullseye(c.x, c.y, t.r);
    }
  }

  function drawRockets() {
    for (var i = 0; i < rockets.length; i++) {
      var r = rockets[i];
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(Math.atan2(r.vy, r.vx));
      ctx.scale(S / 1.4, S / 1.4);
      ctx.fillStyle = 'rgba(255,170,40,0.9)';
      ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-18 - Math.random() * 8, 0); ctx.lineTo(-8, 3); ctx.fill();
      R(-8, -3, 13, 6, '#6b6f5a');
      ctx.fillStyle = RED;
      ctx.beginPath(); ctx.moveTo(5, -3); ctx.lineTo(11, 0); ctx.lineTo(5, 3); ctx.fill();
      ctx.restore();
    }
  }

  function drawParts() {
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      if (q.kind === 'flash') { C(q.x, q.y, q.r * q.life + 2, 'rgba(255,230,140,' + q.life + ')'); continue; }
      if (q.kind === 'ring') {
        ctx.strokeStyle = 'rgba(255,220,150,' + q.life + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (q.kind === 'smoke') ctx.fillStyle = 'rgba(200,190,175,' + q.life * 0.35 + ')';
      else if (q.kind === 'spark') ctx.fillStyle = q.life > 0.5 ? 'rgba(255,240,170,' + q.life + ')' : 'rgba(230,110,40,' + q.life + ')';
      else { ctx.globalAlpha = Math.min(1, q.life * 2); ctx.fillStyle = q.c; }
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawHud() {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    var secs = Math.ceil(timeLeft);
    ctx.font = '44px Anton, Impact, sans-serif';
    ctx.fillStyle = 'rgba(28,25,22,0.8)';
    ctx.fillRect(W / 2 - 70, 12, 140, 56);
    ctx.fillStyle = secs <= 10 ? (secs % 2 ? '#ff5a3a' : '#ffd0a0') : TAN;
    ctx.fillText('0:' + (secs < 10 ? '0' : '') + secs, W / 2, 41);

    ctx.textAlign = 'left';
    ctx.font = '26px Anton, Impact, sans-serif';
    ctx.fillStyle = TAN;
    ctx.fillText('SCORE ' + score, 16, 34);
    if (combo >= 3) {
      ctx.fillStyle = '#ffd700';
      ctx.font = '18px Anton, Impact, sans-serif';
      ctx.fillText('COMBO x' + Math.min(5, 1 + Math.floor((combo - 1) / 3)), 16, 62);
    }

    for (var i = 0; i < texts.length; i++) {
      var tx = texts[i];
      ctx.globalAlpha = tx.life;
      ctx.textAlign = 'center';
      ctx.font = '22px Anton, Impact, sans-serif';
      ctx.fillStyle = tx.gold ? '#ffd700' : '#fff';
      ctx.fillText(tx.s, tx.x, tx.y);
      ctx.globalAlpha = 1;
    }

    if (state === 'play') {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, 12, 0, Math.PI * 2);
      ctx.moveTo(aim.x - 18, aim.y); ctx.lineTo(aim.x - 6, aim.y);
      ctx.moveTo(aim.x + 6, aim.y); ctx.lineTo(aim.x + 18, aim.y);
      ctx.moveTo(aim.x, aim.y - 18); ctx.lineTo(aim.x, aim.y - 6);
      ctx.moveTo(aim.x, aim.y + 6); ctx.lineTo(aim.x, aim.y + 18);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    R(0, GROUND, W, H - GROUND, 'rgba(40,30,20,0.6)');
    drawTargets();
    drawSoldier();
    drawRockets();
    drawParts();
    drawHud();
  }

  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function loopStart() {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  // ---------- input ----------

  function setAim(e) {
    var r = canvas.getBoundingClientRect();
    aim.x = e.clientX - r.left;
    aim.y = e.clientY - r.top;
  }

  canvas.addEventListener('pointermove', setAim);
  canvas.addEventListener('pointerdown', function (e) {
    if (state !== 'play') return;
    e.preventDefault();
    setAim(e);
    firing = true;
    if (cooldown <= 0) fireRocket();
  });
  window.addEventListener('pointerup', function () { firing = false; });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === ' ' && state === 'play') { e.preventDefault(); if (cooldown <= 0) fireRocket(); }
  });

  window.addEventListener('resize', function () { if (!modal.hidden) resize(); });

  document.getElementById('play-btn').addEventListener('click', open);
  document.getElementById('game-go').addEventListener('click', start);
  document.getElementById('game-again').addEventListener('click', start);
  document.getElementById('game-exit').addEventListener('click', close);
  document.getElementById('game-close').addEventListener('click', close);
})();
