// Web Audio API-based sound engine + cinematic sample playback.
// Procedural SFX cover the small UI sounds; the big booms (explosion / nuke)
// use realistic CDN-hosted MP3 samples so they feel like Hollywood-grade
// detonations instead of synth chirps. Respects user toggles in localStorage
// ("sfx_on" / "music_on").

import explosionAsset from "@/assets/sfx/explosion.mp3.asset.json";
import nukeAsset from "@/assets/sfx/nuke.mp3.asset.json";

type SfxKind =
  | "click"
  | "catch"
  | "coin"
  | "explosion"
  | "nuke"
  | "splash"
  | "success"
  | "whoosh"
  | "error"
  | "dice"
  | "hop"
  | "capture"
  | "home";


// Realistic explosion / nuke samples — preloaded as HTMLAudio for low-latency
// playback. We clone the element on each play() so overlapping booms still work.
const SAMPLE_URLS: Partial<Record<SfxKind, string>> = {
  explosion: explosionAsset.url,
  nuke: nukeAsset.url,
};
const SAMPLE_VOLUMES: Partial<Record<SfxKind, number>> = {
  explosion: 0.95,
  nuke: 1.0,
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private musicOn = true;
  private sfxOn = true;
  private musicPlaying = false;
  private pausedForChat = false;
  private inited = false;
  private sampleEls: Partial<Record<SfxKind, HTMLAudioElement>> = {};

  init() {
    if (typeof window === "undefined") return;
    if (this.inited) return;
    this.sfxOn = window.localStorage.getItem("sfx_on") !== "0";
    this.musicOn = window.localStorage.getItem("music_on") !== "0";
    // Preload the cinematic sample SFX so the first boom plays instantly.
    for (const [kind, url] of Object.entries(SAMPLE_URLS) as [SfxKind, string][]) {
      const el = new Audio(url);
      el.preload = "auto";
      el.volume = SAMPLE_VOLUMES[kind] ?? 1;
      this.sampleEls[kind] = el;
    }
    this.inited = true;
  }

  private playSample(kind: SfxKind) {
    const src = SAMPLE_URLS[kind];
    if (!src) return false;
    try {
      const node = (this.sampleEls[kind]?.cloneNode(true) as HTMLAudioElement | undefined)
        ?? new Audio(src);
      node.volume = SAMPLE_VOLUMES[kind] ?? 1;
      void node.play().catch(() => { /* autoplay may need a user gesture */ });
    } catch { /* noop */ }
    return true;
  }

  private ensureCtx() {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  private ensureMusicEl() {
    if (typeof window === "undefined") return null;
    if (this.musicEl) return this.musicEl;
    const el = new Audio("/sea-music.mp3");
    el.loop = true;
    el.preload = "auto";
    el.volume = 0.35;
    this.musicEl = el;
    return el;
  }

  getSfx() { this.init(); return this.sfxOn; }
  getMusic() { this.init(); return this.musicOn; }

  setSfx(v: boolean) {
    this.init();
    this.sfxOn = v;
    if (typeof window !== "undefined") window.localStorage.setItem("sfx_on", v ? "1" : "0");
  }
  setMusic(v: boolean) {
    this.init();
    this.musicOn = v;
    if (typeof window !== "undefined") window.localStorage.setItem("music_on", v ? "1" : "0");
    if (v) this.startMusic(); else this.stopMusic();
  }

  resume() {
    const c = this.ensureCtx();
    if (c && c.state === "suspended") void c.resume();
  }

  startMusic() {
    this.init();
    if (!this.musicOn) return;
    if (this.pausedForChat) return;
    const el = this.ensureMusicEl();
    if (!el) return;
    this.musicPlaying = true;
    void el.play().catch(() => { /* will retry on next user gesture */ });
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicEl) {
      try { this.musicEl.pause(); } catch { /* noop */ }
      try { this.musicEl.currentTime = 0; } catch { /* noop */ }
    }
  }

  // Temporary pause for screens like chat. Does NOT change saved music
  // preference — resumeForChat() resumes only if music is still enabled.
  pauseForChat() {
    this.pausedForChat = true;
    if (this.musicEl) { try { this.musicEl.pause(); } catch { /* noop */ } }
  }

  resumeForChat() {
    if (!this.pausedForChat) return;
    this.pausedForChat = false;
    if (this.musicOn && this.musicPlaying && this.musicEl) {
      void this.musicEl.play().catch(() => { /* noop */ });
    }
  }

  play(kind: SfxKind) {
    this.init();
    if (!this.sfxOn) return;
    // Realistic cinematic samples (explosion / nuke) — play the MP3 directly
    // and skip the procedural synth fallback below.
    if (SAMPLE_URLS[kind] && this.playSample(kind)) return;
    const c = this.ensureCtx();
    if (!c || !this.masterGain) return;
    const t = c.currentTime;
    const M = this.masterGain;

    if (kind === "click") {
      const o = c.createOscillator(); const g = c.createGain();
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(400, t + 0.07);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(M); o.start(t); o.stop(t + 0.1);
    } else if (kind === "catch") {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.06;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.16, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.22);
        o.connect(g).connect(M); o.start(s); o.stop(s + 0.24);
      });
    } else if (kind === "coin") {
      const o1 = c.createOscillator(); const o2 = c.createOscillator(); const g = c.createGain();
      o1.frequency.value = 988; o2.frequency.value = 1318;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o1.connect(g); o2.connect(g); g.connect(M);
      o1.start(t); o1.stop(t + 0.05);
      o2.start(t + 0.05); o2.stop(t + 0.2);
    } else if (kind === "explosion") {
      // Realistic layered explosion: sharp crack + body noise + deep sub thud + long rumble tail
      // 1) Initial crack (very short, bright transient)
      {
        const sz = (c.sampleRate * 0.05) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / sz);
        const n = c.createBufferSource(); n.buffer = b;
        const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1500;
        const g = c.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        n.connect(hp).connect(g).connect(M); n.start(t);
      }
      // 2) Main body — low-passed white noise, longer decay
      {
        const sz = (c.sampleRate * 1.4) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sz, 1.4);
        const n = c.createBufferSource(); n.buffer = b;
        const lp = c.createBiquadFilter(); lp.type = "lowpass";
        lp.frequency.setValueAtTime(2800, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + 1.3);
        const g = c.createGain();
        g.gain.setValueAtTime(0.85, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        n.connect(lp).connect(g).connect(M); n.start(t);
      }
      // 3) Sub-bass thud (deep "boom")
      {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(22, t + 0.9);
        g.gain.setValueAtTime(0.85, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
        o.connect(g).connect(M); o.start(t); o.stop(t + 1.0);
      }
      // 4) Distorted growl for menace
      {
        const o = c.createOscillator(); const g = c.createGain();
        const ws = c.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 4); }
        ws.curve = curve;
        o.type = "sawtooth";
        o.frequency.setValueAtTime(60, t + 0.04);
        o.frequency.exponentialRampToValueAtTime(18, t + 0.85);
        g.gain.setValueAtTime(0.35, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        o.connect(ws).connect(g).connect(M); o.start(t + 0.04); o.stop(t + 0.95);
      }
    } else if (kind === "nuke") {
      // Massive cinematic nuclear detonation: huge flash crack, enormous body, very deep
      // collapsing sub, long ominous rumble tail with shifting filter.
      const out = c.createGain(); out.gain.value = 1.0; out.connect(M);
      // 1) Bright flash transient
      {
        const sz = (c.sampleRate * 0.08) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / sz);
        const n = c.createBufferSource(); n.buffer = b;
        const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1200;
        const g = c.createGain(); g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        n.connect(hp).connect(g).connect(out); n.start(t);
      }
      // 2) Massive body
      {
        const sz = (c.sampleRate * 3.2) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sz, 1.1);
        const n = c.createBufferSource(); n.buffer = b;
        const lp = c.createBiquadFilter(); lp.type = "lowpass";
        lp.frequency.setValueAtTime(3200, t);
        lp.frequency.exponentialRampToValueAtTime(80, t + 3.0);
        const g = c.createGain();
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
        n.connect(lp).connect(g).connect(out); n.start(t);
      }
      // 3) Earth-shaking sub
      {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(14, t + 2.2);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
        o.connect(g).connect(out); o.start(t); o.stop(t + 2.5);
      }
      // 4) Ominous metallic growl
      {
        const o = c.createOscillator(); const g = c.createGain();
        const ws = c.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 6); }
        ws.curve = curve;
        o.type = "sawtooth";
        o.frequency.setValueAtTime(50, t + 0.05);
        o.frequency.exponentialRampToValueAtTime(15, t + 2.4);
        g.gain.setValueAtTime(0.45, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
        o.connect(ws).connect(g).connect(out); o.start(t + 0.05); o.stop(t + 2.5);
      }
    } else if (kind === "splash") {
      const bufSize = c.sampleRate * 0.35;
      const buf = c.createBuffer(1, bufSize, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.25));
      const noise = c.createBufferSource(); noise.buffer = buf;
      const filt = c.createBiquadFilter(); filt.type = "highpass"; filt.frequency.value = 700;
      const g = c.createGain(); g.gain.value = 0.3;
      noise.connect(filt).connect(g).connect(M); noise.start(t);
    } else if (kind === "success") {
      [523, 659, 784, 1046].forEach((f, i) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.08;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.18, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.26);
        o.connect(g).connect(M); o.start(s); o.stop(s + 0.28);
      });
    } else if (kind === "whoosh") {
      const bufSize = c.sampleRate * 0.3;
      const buf = c.createBuffer(1, bufSize, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1);
      const noise = c.createBufferSource(); noise.buffer = buf;
      const filt = c.createBiquadFilter(); filt.type = "bandpass";
      filt.frequency.setValueAtTime(400, t);
      filt.frequency.exponentialRampToValueAtTime(1700, t + 0.3);
      filt.Q.value = 5;
      const g = c.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      noise.connect(filt).connect(g).connect(M); noise.start(t);
    } else if (kind === "error") {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "sawtooth"; o.frequency.value = 220;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(M); o.start(t); o.stop(t + 0.22);
    } else if (kind === "dice") {
      // Rattling dice — burst of short filtered noise ticks + final thud
      for (let k = 0; k < 7; k++) {
        const start = t + k * 0.055;
        const sz = (c.sampleRate * 0.04) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / sz);
        const n = c.createBufferSource(); n.buffer = b;
        const bp = c.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = 1600 + Math.random() * 1400; bp.Q.value = 4;
        const g = c.createGain(); g.gain.setValueAtTime(0.28, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
        n.connect(bp).connect(g).connect(M); n.start(start);
      }
      // Final thud
      const tf = t + 0.45;
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(180, tf);
      o.frequency.exponentialRampToValueAtTime(60, tf + 0.18);
      g.gain.setValueAtTime(0.4, tf);
      g.gain.exponentialRampToValueAtTime(0.001, tf + 0.22);
      o.connect(g).connect(M); o.start(tf); o.stop(tf + 0.25);
    } else if (kind === "hop") {
      // Short blip for each token step
      const o = c.createOscillator(); const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(780, t + 0.06);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(M); o.start(t); o.stop(t + 0.1);
    } else if (kind === "capture") {
      // "Hit + zap" for capturing an enemy piece
      // 1) Sharp low thud
      {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.connect(g).connect(M); o.start(t); o.stop(t + 0.24);
      }
      // 2) Descending sweep (whoosh back home)
      {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(900, t + 0.05);
        o.frequency.exponentialRampToValueAtTime(120, t + 0.5);
        g.gain.setValueAtTime(0.22, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
        const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500;
        o.connect(lp).connect(g).connect(M); o.start(t + 0.05); o.stop(t + 0.55);
      }
      // 3) Noise burst
      {
        const sz = (c.sampleRate * 0.15) | 0;
        const b = c.createBuffer(1, sz, c.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / sz);
        const n = c.createBufferSource(); n.buffer = b;
        const bp = c.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = 2200; bp.Q.value = 2;
        const g = c.createGain(); g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        n.connect(bp).connect(g).connect(M); n.start(t);
      }
    } else if (kind === "home") {
      // Triumphant chime — 5-note arpeggio + shimmer
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        const o = c.createOscillator(); const g = c.createGain();
        o.type = "triangle"; o.frequency.value = f;
        const s = t + i * 0.09;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.22, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, s + 0.4);
        o.connect(g).connect(M); o.start(s); o.stop(s + 0.42);
      });
      // Sparkle noise tail
      const sz = (c.sampleRate * 0.5) | 0;
      const b = c.createBuffer(1, sz, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < sz; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / sz, 2);
      const n = c.createBufferSource(); n.buffer = b;
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3500;
      const g = c.createGain(); g.gain.setValueAtTime(0.12, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      n.connect(hp).connect(g).connect(M); n.start(t + 0.3);
    }
  }
}


export const sound = new SoundEngine();
