/* =========================================================
   ملوك القراصنة — Playable Ad
   Self-contained HTML5 canvas mini-game. No external deps.
   ========================================================= */
(function () {
  'use strict';

  // ----- CONFIG -------------------------------------------------------
  var CONFIG = {
    DURATION: 25,          // seconds of gameplay
    STORE_URL: 'https://play.google.com/store/apps/details?id=com.hamor.game',
    GOAL_SHIPS: 8          // ends early with a win when reached
  };
  // Ad-network click macro support (Google / IronSource / Unity / Mintegral)
  function openStore() {
    try {
      if (window.mraid && mraid.open) { mraid.open(CONFIG.STORE_URL); return; }
      if (window.ExitApi && ExitApi.exit) { ExitApi.exit(); return; }
      if (window.FbPlayableAd && FbPlayableAd.onCTAClick) { FbPlayableAd.onCTAClick(); return; }
      window.open(CONFIG.STORE_URL, '_blank');
    } catch (e) { window.open(CONFIG.STORE_URL, '_blank'); }
  }

  // ----- SETUP --------------------------------------------------------
  var cv = document.getElementById('game'), cx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  var $ = function (id) { return document.getElementById(id); };
  var elScore = $('score'), elTime = $('time'), elScoreBox = $('scoreBox');
  var elTut = $('tutorial'), elEnd = $('endcard'), elEcScore = $('ecScore');

  // ----- STATE --------------------------------------------------------
  var S, shake = 0, last = 0, started = false, over = false;

  function reset() {
    S = {
      t: CONFIG.DURATION, score: 0, aim: -Math.PI / 2, power: 1,
      cd: 0, ships: [], balls: [], parts: [], smoke: [], rings: [],
      spawnT: 0.4, interacted: false, wave: 0
    };
    shake = 0; over = false;
    elScore.textContent = '0';
    elTime.textContent = CONFIG.DURATION;
    elEnd.classList.remove('show');
    elTut.classList.remove('hide');
  }

  function seaY() { return H * 0.52; }
  function cannon() { return { x: W / 2, y: H - Math.max(78, H * 0.15) }; }

  // ----- ENTITIES -----------------------------------------------------
  function spawnShip() {
    var dir = Math.random() < 0.5 ? 1 : -1;
    var lane = 0.18 + Math.random() * 0.62;            // 0..1 across sea band
    var y = seaY() + 26 + lane * (H * 0.30);
    var scale = 0.62 + lane * 0.75;
    S.ships.push({
      x: dir > 0 ? -90 : W + 90, y: y, dir: dir,
      sp: (26 + Math.random() * 26) * (0.7 + lane * 0.7),
      s: scale, hp: 2, hit: 0, sink: 0, bob: Math.random() * 6.28,
      hull: ['#8b3a2a', '#3f5f8a', '#4a6b3a', '#6b3a6b'][(Math.random() * 4) | 0]
    });
  }

  function fire() {
    if (S.cd > 0 || over) return;
    S.cd = 0.28;
    var c = cannon(), sp = 720;
    S.balls.push({ x: c.x + Math.cos(S.aim) * 42, y: c.y + Math.sin(S.aim) * 42,
                   vx: Math.cos(S.aim) * sp, vy: Math.sin(S.aim) * sp, life: 2.2 });
    // muzzle flash
    for (var i = 0; i < 14; i++) {
      var a = S.aim + (Math.random() - 0.5) * 0.9, v = 60 + Math.random() * 180;
      S.parts.push({ x: c.x + Math.cos(S.aim) * 40, y: c.y + Math.sin(S.aim) * 40,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3, max: 0.3, r: 2 + Math.random() * 3,
        col: Math.random() < .5 ? '#ffd166' : '#ff8a3c' });
    }
    shake = Math.max(shake, 4);
    Sfx.play('shoot');
  }

  function boom(x, y, big) {
    var n = big ? 46 : 26;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, v = (big ? 120 : 70) + Math.random() * (big ? 320 : 190);
      S.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
        life: 0.5 + Math.random() * 0.5, max: 1, r: 2 + Math.random() * (big ? 5 : 3),
        col: ['#fff2b0', '#ffcc44', '#ff7a1a', '#ff3d2e'][(Math.random() * 4) | 0] });
    }
    for (var j = 0; j < (big ? 14 : 7); j++) {
      S.smoke.push({ x: x + (Math.random() - .5) * 24, y: y + (Math.random() - .5) * 18,
        vx: (Math.random() - .5) * 26, vy: -18 - Math.random() * 34,
        life: 1.1 + Math.random() * 0.9, max: 2, r: 10 + Math.random() * 18 });
    }
    S.rings.push({ x: x, y: y, r: big ? 12 : 8, life: 0.42, max: 0.42, w: big ? 6 : 4 });
    shake = Math.max(shake, big ? 16 : 9);
    Sfx.play(big ? 'sink' : 'hit');
  }

  // ----- INPUT --------------------------------------------------------
  function aimTo(px, py) {
    var c = cannon(), a = Math.atan2(py - c.y, px - c.x);
    // clamp to upper half, avoid shooting into the deck
    if (a > -0.18) a = a > Math.PI / 2 ? -Math.PI + 0.18 : -0.18;
    if (a < -Math.PI + 0.18) a = -Math.PI + 0.18;
    S.aim = a;
  }
  function interacted() {
    if (!S.interacted) { S.interacted = true; elTut.classList.add('hide'); }
    Sfx.init();
  }
  function pos(e) {
    var r = cv.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  var dragging = false, moved = false, downAt = 0;
  function onDown(e) {
    if (over) return; e.preventDefault();
    dragging = true; moved = false; downAt = performance.now();
    interacted(); var p = pos(e); aimTo(p.x, p.y);
  }
  function onMove(e) {
    if (!dragging || over) return; e.preventDefault();
    moved = true; var p = pos(e); aimTo(p.x, p.y);
  }
  function onUp(e) {
    if (!dragging || over) return; if (e.cancelable) e.preventDefault();
    dragging = false; fire();
  }
  cv.addEventListener('touchstart', onDown, { passive: false });
  cv.addEventListener('touchmove', onMove, { passive: false });
  cv.addEventListener('touchend', onUp, { passive: false });
  cv.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  $('muteBtn').addEventListener('click', function () {
    Sfx.init();
    $('muteBtn').textContent = Sfx.toggle() ? '🔇' : '🔊';
  });
  $('ctaBtn').addEventListener('click', function (e) { e.preventDefault(); openStore(); });
  $('replayBtn').addEventListener('click', function () { reset(); started = true; });
  // whole end-card background is clickable too (except replay)
  elEnd.addEventListener('click', function (e) {
    if (e.target === elEnd || e.target.classList.contains('ec-inner')) openStore();
  });

  // ----- UPDATE -------------------------------------------------------
  function update(dt) {
    if (over) { stepFx(dt); return; }
    S.wave += dt;
    S.t -= dt;
    var ts = Math.max(0, Math.ceil(S.t));
    if (elTime.textContent !== String(ts)) elTime.textContent = ts;
    if (S.t <= 0) return end();

    if (S.cd > 0) S.cd -= dt;

    // spawn
    S.spawnT -= dt;
    if (S.spawnT <= 0) {
      spawnShip();
      S.spawnT = Math.max(0.55, 1.5 - S.score * 0.09);
    }

    // ships
    for (var i = S.ships.length - 1; i >= 0; i--) {
      var s = S.ships[i];
      if (s.sink > 0) {
        s.sink += dt; s.y += 26 * dt;
        if (s.sink > 1.5) S.ships.splice(i, 1);
        continue;
      }
      s.x += s.dir * s.sp * dt;
      if (s.hit > 0) s.hit -= dt;
      if (s.x < -140 || s.x > W + 140) S.ships.splice(i, 1);
    }

    // balls
    for (var b = S.balls.length - 1; b >= 0; b--) {
      var o = S.balls[b];
      o.vy += 520 * dt;
      o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt;
      var killed = false;
      for (var k = 0; k < S.ships.length; k++) {
        var sh = S.ships[k]; if (sh.sink > 0) continue;
        var hw = 52 * sh.s, hh = 26 * sh.s;
        if (Math.abs(o.x - sh.x) < hw && Math.abs(o.y - sh.y) < hh) {
          sh.hp--; sh.hit = 0.22;
          if (sh.hp <= 0) {
            sh.sink = 0.001; S.score++;
            elScore.textContent = S.score;
            elScoreBox.classList.remove('pop'); void elScoreBox.offsetWidth; elScoreBox.classList.add('pop');
            boom(o.x, o.y, true);
            if (S.score >= CONFIG.GOAL_SHIPS) { setTimeout(end, 700); }
          } else boom(o.x, o.y, false);
          killed = true; break;
        }
      }
      if (!killed && o.y > seaY() + 10 && o.vy > 0) {
        // water splash
        for (var w = 0; w < 10; w++) {
          S.parts.push({ x: o.x, y: o.y, vx: (Math.random() - .5) * 120, vy: -60 - Math.random() * 120,
            life: 0.4, max: 0.4, r: 1.5 + Math.random() * 2.5, col: '#bfe9ff' });
        }
        S.rings.push({ x: o.x, y: o.y, r: 4, life: 0.35, max: 0.35, w: 2 });
        Sfx.play('splash'); killed = true;
      }
      if (killed || o.life <= 0 || o.x < -60 || o.x > W + 60) S.balls.splice(b, 1);
    }

    stepFx(dt);
  }

  function stepFx(dt) {
    var i;
    for (i = S.parts.length - 1; i >= 0; i--) {
      var p = S.parts[i];
      p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) S.parts.splice(i, 1);
    }
    for (i = S.smoke.length - 1; i >= 0; i--) {
      var m = S.smoke[i];
      m.x += m.vx * dt; m.y += m.vy * dt; m.r += 22 * dt; m.life -= dt;
      if (m.life <= 0) S.smoke.splice(i, 1);
    }
    for (i = S.rings.length - 1; i >= 0; i--) {
      var r = S.rings[i]; r.r += 200 * dt; r.life -= dt;
      if (r.life <= 0) S.rings.splice(i, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 34);
  }

  function end() {
    if (over) return;
    over = true;
    elTut.classList.add('hide');
    elEcScore.textContent = S.score;
    elEnd.classList.add('show');
    Sfx.play('win');
  }

  // ----- RENDER -------------------------------------------------------
  function sky() {
    var g = cx.createLinearGradient(0, 0, 0, seaY());
    g.addColorStop(0, '#0a2a49'); g.addColorStop(.45, '#1d5b86');
    g.addColorStop(.8, '#e98b45'); g.addColorStop(1, '#ffce7a');
    cx.fillStyle = g; cx.fillRect(0, 0, W, seaY() + 2);
    // sun
    var sx = W * 0.5, sy = seaY() - H * 0.055;
    var sg = cx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.22);
    sg.addColorStop(0, 'rgba(255,236,170,.95)'); sg.addColorStop(.35, 'rgba(255,180,80,.45)');
    sg.addColorStop(1, 'rgba(255,150,60,0)');
    cx.fillStyle = sg; cx.beginPath(); cx.arc(sx, sy, H * 0.22, 0, 6.283); cx.fill();
    cx.fillStyle = 'rgba(255,244,200,.95)';
    cx.beginPath(); cx.arc(sx, sy, H * 0.045, 0, 6.283); cx.fill();
    // clouds
    cx.fillStyle = 'rgba(255,255,255,.10)';
    for (var i = 0; i < 5; i++) {
      var cxp = ((i * 0.27 + S.wave * 0.006) % 1.25 - 0.12) * W;
      var cyp = H * (0.08 + (i % 3) * 0.06), cw = W * (0.16 + (i % 3) * 0.07);
      cx.beginPath(); cx.ellipse(cxp, cyp, cw, cw * 0.22, 0, 0, 6.283); cx.fill();
    }
  }

  function sea() {
    var y0 = seaY();
    var g = cx.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, '#0e5c86'); g.addColorStop(.5, '#0a3f68'); g.addColorStop(1, '#062440');
    cx.fillStyle = g; cx.fillRect(0, y0, W, H - y0);
    // sun glitter path
    cx.save(); cx.beginPath(); cx.rect(0, y0, W, H - y0); cx.clip();
    cx.fillStyle = 'rgba(255,190,90,.16)';
    for (var i = 0; i < 22; i++) {
      var f = i / 22, yy = y0 + f * (H - y0);
      var ww = (14 + f * 90) * (0.6 + 0.4 * Math.sin(S.wave * 2 + i));
      cx.fillRect(W / 2 - ww / 2 + Math.sin(S.wave * 1.6 + i) * 12, yy, ww, 2 + f * 2);
    }
    // waves
    for (var L = 0; L < 4; L++) {
      var amp = 3 + L * 2.4, base = y0 + 16 + L * (H - y0) * 0.22;
      cx.beginPath(); cx.moveTo(0, base);
      for (var x = 0; x <= W; x += 12) {
        cx.lineTo(x, base + Math.sin((x / (60 + L * 22)) + S.wave * (1.2 + L * 0.35)) * amp);
      }
      cx.lineTo(W, H); cx.lineTo(0, H); cx.closePath();
      cx.fillStyle = 'rgba(255,255,255,' + (0.035 + L * 0.012) + ')'; cx.fill();
    }
    cx.restore();
  }

  function drawShip(s) {
    cx.save();
    var bob = Math.sin(S.wave * 2.2 + s.bob) * 3 * s.s;
    cx.translate(s.x, s.y + bob);
    if (s.sink > 0) { cx.rotate(Math.min(0.9, s.sink * 1.1) * s.dir); cx.globalAlpha = Math.max(0, 1 - s.sink / 1.5); }
    cx.scale(s.s * s.dir, s.s);
    // reflection
    cx.globalAlpha *= 1;
    cx.fillStyle = 'rgba(0,0,0,.18)';
    cx.beginPath(); cx.ellipse(0, 22, 56, 7, 0, 0, 6.283); cx.fill();
    // mast + sail
    cx.strokeStyle = '#5a3b22'; cx.lineWidth = 4;
    cx.beginPath(); cx.moveTo(0, 2); cx.lineTo(0, -64); cx.stroke();
    var sg = cx.createLinearGradient(0, -62, 0, -8);
    sg.addColorStop(0, '#fdf6e6'); sg.addColorStop(1, '#d9c9a5');
    cx.fillStyle = sg;
    cx.beginPath(); cx.moveTo(2, -60); cx.quadraticCurveTo(44, -38, 2, -10); cx.closePath(); cx.fill();
    cx.fillStyle = '#1b1b1b';
    cx.beginPath(); cx.arc(16, -35, 6, 0, 6.283); cx.fill();
    // flag
    cx.fillStyle = '#14181d';
    cx.beginPath(); cx.moveTo(0, -64); cx.lineTo(24, -58); cx.lineTo(0, -52); cx.closePath(); cx.fill();
    // hull
    var hg = cx.createLinearGradient(0, -12, 0, 20);
    hg.addColorStop(0, s.hull); hg.addColorStop(1, '#2b1a12');
    cx.fillStyle = hg;
    cx.beginPath();
    cx.moveTo(-52, -10); cx.lineTo(52, -10);
    cx.quadraticCurveTo(44, 20, 0, 20); cx.quadraticCurveTo(-44, 20, -52, -10);
    cx.closePath(); cx.fill();
    cx.fillStyle = 'rgba(255,220,150,.35)'; cx.fillRect(-46, -8, 92, 3);
    // portholes
    cx.fillStyle = '#ffcf7a';
    for (var i = -3; i <= 3; i++) { cx.beginPath(); cx.arc(i * 13, 3, 2.4, 0, 6.283); cx.fill(); }
    // damage tint
    if (s.hit > 0) { cx.fillStyle = 'rgba(255,255,255,' + (s.hit * 2.6) + ')';
      cx.beginPath(); cx.moveTo(-52, -10); cx.lineTo(52, -10);
      cx.quadraticCurveTo(44, 20, 0, 20); cx.quadraticCurveTo(-44, 20, -52, -10);
      cx.closePath(); cx.fill(); }
    if (s.hp <= 1 && s.sink <= 0) {
      cx.fillStyle = 'rgba(60,60,60,.5)';
      cx.beginPath(); cx.arc(-10 + Math.sin(S.wave * 4) * 4, -18, 9, 0, 6.283); cx.fill();
    }
    cx.restore();
  }

  function drawCannon() {
    var c = cannon();
    // deck
    var dg = cx.createLinearGradient(0, c.y - 22, 0, H);
    dg.addColorStop(0, '#6b4527'); dg.addColorStop(1, '#2c1a0e');
    cx.fillStyle = dg;
    cx.beginPath();
    cx.moveTo(-20, H); cx.lineTo(W * 0.14, c.y + 6);
    cx.lineTo(W * 0.86, c.y + 6); cx.lineTo(W + 20, H); cx.closePath(); cx.fill();
    cx.strokeStyle = 'rgba(0,0,0,.25)'; cx.lineWidth = 2;
    for (var i = 1; i < 6; i++) {
      var t = i / 6;
      cx.beginPath(); cx.moveTo(W * (0.14 + 0.72 * t), c.y + 7); cx.lineTo(W * (0.14 + 0.72 * t), H); cx.stroke();
    }
    // aim guide
    cx.save();
    cx.setLineDash([6, 10]); cx.strokeStyle = 'rgba(255,214,120,.55)'; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(c.x + Math.cos(S.aim) * 52, c.y + Math.sin(S.aim) * 52);
    cx.lineTo(c.x + Math.cos(S.aim) * 190, c.y + Math.sin(S.aim) * 190); cx.stroke();
    cx.restore();
    // barrel
    cx.save(); cx.translate(c.x, c.y); cx.rotate(S.aim);
    var bg = cx.createLinearGradient(0, -9, 0, 9);
    bg.addColorStop(0, '#8e99a6'); bg.addColorStop(.5, '#4b555f'); bg.addColorStop(1, '#232a31');
    cx.fillStyle = bg;
    cx.beginPath(); cx.roundRect ? cx.roundRect(4, -9, 56, 18, 6) : cx.rect(4, -9, 56, 18); cx.fill();
    cx.fillStyle = '#161c22'; cx.beginPath(); cx.arc(60, 0, 9, 0, 6.283); cx.fill();
    cx.restore();
    // base
    cx.fillStyle = '#3a2a1a'; cx.beginPath(); cx.arc(c.x, c.y + 4, 20, Math.PI, 0); cx.fill();
    cx.fillStyle = '#6b4527'; cx.beginPath(); cx.arc(c.x, c.y + 4, 13, 0, 6.283); cx.fill();
    // reload flash
    if (S.cd > 0) {
      cx.strokeStyle = 'rgba(255,209,102,.8)'; cx.lineWidth = 3;
      cx.beginPath(); cx.arc(c.x, c.y + 4, 26, -Math.PI, -Math.PI + Math.PI * (1 - S.cd / 0.28)); cx.stroke();
    }
  }

  function drawFx() {
    var i;
    for (i = 0; i < S.smoke.length; i++) {
      var m = S.smoke[i], a = Math.max(0, m.life / m.max) * 0.5;
      cx.fillStyle = 'rgba(70,70,78,' + a + ')';
      cx.beginPath(); cx.arc(m.x, m.y, m.r, 0, 6.283); cx.fill();
    }
    cx.globalCompositeOperation = 'lighter';
    for (i = 0; i < S.parts.length; i++) {
      var p = S.parts[i], al = Math.max(0, p.life / p.max);
      cx.globalAlpha = al; cx.fillStyle = p.col;
      cx.beginPath(); cx.arc(p.x, p.y, p.r * (0.4 + al * 0.8), 0, 6.283); cx.fill();
    }
    cx.globalAlpha = 1;
    for (i = 0; i < S.rings.length; i++) {
      var r = S.rings[i], ra = Math.max(0, r.life / r.max);
      cx.globalAlpha = ra; cx.strokeStyle = '#ffe08a'; cx.lineWidth = r.w * ra;
      cx.beginPath(); cx.arc(r.x, r.y, r.r, 0, 6.283); cx.stroke();
    }
    cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over';
    // cannon balls
    for (i = 0; i < S.balls.length; i++) {
      var b = S.balls[i];
      cx.fillStyle = 'rgba(255,190,90,.25)';
      cx.beginPath(); cx.arc(b.x - b.vx * 0.012, b.y - b.vy * 0.012, 8, 0, 6.283); cx.fill();
      cx.fillStyle = '#1a1f25';
      cx.beginPath(); cx.arc(b.x, b.y, 6.5, 0, 6.283); cx.fill();
      cx.fillStyle = 'rgba(255,255,255,.5)';
      cx.beginPath(); cx.arc(b.x - 2, b.y - 2, 2, 0, 6.283); cx.fill();
    }
  }

  function vignette() {
    var g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  }

  function render() {
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (shake > 0.2) {
      cx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    }
    sky(); sea();
    S.ships.sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < S.ships.length; i++) drawShip(S.ships[i]);
    drawCannon();
    drawFx();
    vignette();
  }

  // ----- LOOP ---------------------------------------------------------
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000); last = ts;
    if (!started) return;
    update(dt); render();
  }

  reset();
  started = true;
  requestAnimationFrame(loop);

  // pause audio when page hidden (ad-network friendly)
  document.addEventListener('visibilitychange', function () { last = 0; });
})();
