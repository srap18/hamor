/* Tiny procedural sound engine (WebAudio) — no external audio files, zero KB payload. */
(function (global) {
  var ctx = null, master = null, muted = false, ready = false;

  function init() {
    if (ready) return;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { ready = true; return; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { ready = true; }
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function tone(opts) {
    if (!ctx || muted) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t + opts.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.3, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + opts.dur + 0.02);
  }

  function noise(dur, vol, freq, type) {
    if (!ctx || muted) return;
    var t = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 900;
    var g = ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  var SFX = {
    shoot: function () { tone({ type: 'square', f0: 320, f1: 90, dur: 0.16, vol: 0.22 }); noise(0.14, 0.28, 1400); },
    hit:   function () { noise(0.42, 0.5, 700); tone({ type: 'sawtooth', f0: 160, f1: 40, dur: 0.35, vol: 0.3 }); },
    sink:  function () { noise(0.7, 0.35, 380); tone({ type: 'sine', f0: 220, f1: 55, dur: 0.6, vol: 0.22 }); },
    splash:function () { noise(0.25, 0.18, 2200, 'highpass'); },
    win:   function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        setTimeout(function () { tone({ type: 'triangle', f0: f, f1: f, dur: 0.28, vol: 0.26 }); }, i * 110);
      });
    }
  };

  global.Sfx = {
    init: function () { init(); resume(); },
    play: function (name) { if (!ready) init(); resume(); if (SFX[name]) SFX[name](); },
    toggle: function () { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.55; return muted; },
    isMuted: function () { return muted; }
  };
})(window);
