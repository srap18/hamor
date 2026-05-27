// Jungle pitch shifter — adapted from Chris Wilson's Jungle.js (Web Audio).
// Performs real-time pitch shift using two delay lines with modulated delay times
// and crossfading. Preserves perceived speed. Suitable for live voice change.

const delayTime = 0.100;
const fadeTime = 0.050;
const bufferTime = 0.100;

function createFadeBuffer(ctx: AudioContext, activeTime: number, fadeTime: number): AudioBuffer {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  const fadeLength = fadeTime * ctx.sampleRate;
  const fadeIndex1 = fadeLength;
  const fadeIndex2 = length1 - fadeLength;
  for (let i = 0; i < length1; ++i) {
    let value: number;
    if (i < fadeIndex1) value = Math.sqrt(i / fadeLength);
    else if (i >= fadeIndex2) value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
    else value = 1;
    p[i] = value;
  }
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

function createDelayTimeBuffer(ctx: AudioContext, activeTime: number, fadeTime: number, shiftUp: boolean): AudioBuffer {
  const length1 = activeTime * ctx.sampleRate;
  const length2 = (activeTime - 2 * fadeTime) * ctx.sampleRate;
  const length = length1 + length2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length1; ++i) p[i] = shiftUp ? (length1 - i) / length : i / length1;
  for (let i = length1; i < length; ++i) p[i] = 0;
  return buffer;
}

export interface Jungle {
  input: GainNode;
  output: GainNode;
  setPitchOffset: (mult: number) => void;
  destroy: () => void;
}

export function createJungle(ctx: AudioContext): Jungle {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // Two parallel "modulator" branches.
  const mod1 = ctx.createBufferSource();
  const mod2 = ctx.createBufferSource();
  const mod3 = ctx.createBufferSource();
  const mod4 = ctx.createBufferSource();

  const shiftDownBuffer = createDelayTimeBuffer(ctx, bufferTime, fadeTime, false);
  const shiftUpBuffer = createDelayTimeBuffer(ctx, bufferTime, fadeTime, true);
  mod1.buffer = shiftDownBuffer; mod2.buffer = shiftDownBuffer;
  mod3.buffer = shiftUpBuffer; mod4.buffer = shiftUpBuffer;
  mod1.loop = mod2.loop = mod3.loop = mod4.loop = true;

  const mod1Gain = ctx.createGain();
  const mod2Gain = ctx.createGain(); mod2Gain.gain.value = 0;
  const mod3Gain = ctx.createGain();
  const mod4Gain = ctx.createGain(); mod4Gain.gain.value = 0;

  const modGain1 = ctx.createGain();
  const modGain2 = ctx.createGain();

  const delay1 = ctx.createDelay();
  const delay2 = ctx.createDelay();
  mod1.connect(mod1Gain); mod2.connect(mod2Gain);
  mod3.connect(mod3Gain); mod4.connect(mod4Gain);
  mod1Gain.connect(modGain1); mod2Gain.connect(modGain2);
  mod3Gain.connect(modGain1); mod4Gain.connect(modGain2);
  modGain1.connect(delay1.delayTime); modGain2.connect(delay2.delayTime);

  // Crossfades
  const fade1 = ctx.createBufferSource();
  const fade2 = ctx.createBufferSource();
  const fadeBuffer = createFadeBuffer(ctx, bufferTime, fadeTime);
  fade1.buffer = fadeBuffer; fade2.buffer = fadeBuffer;
  fade1.loop = true; fade2.loop = true;

  const mix1 = ctx.createGain(); mix1.gain.value = 0;
  const mix2 = ctx.createGain(); mix2.gain.value = 0;
  fade1.connect(mix1.gain); fade2.connect(mix2.gain);

  input.connect(delay1); input.connect(delay2);
  delay1.connect(mix1); delay2.connect(mix2);
  mix1.connect(output); mix2.connect(output);

  const t = ctx.currentTime + 0.050;
  const t2 = t + bufferTime - fadeTime;
  mod1.start(t); mod2.start(t2); mod3.start(t); mod4.start(t2);
  fade1.start(t); fade2.start(t2);

  const setPitchOffset = (mult: number) => {
    // mult: -1..1 (negative = down, positive = up)
    if (mult > 0) {
      mod1Gain.gain.value = 0; mod2Gain.gain.value = 0;
      mod3Gain.gain.value = 1; mod4Gain.gain.value = 1;
    } else {
      mod1Gain.gain.value = 1; mod2Gain.gain.value = 1;
      mod3Gain.gain.value = 0; mod4Gain.gain.value = 0;
    }
    const interval = Math.abs(mult) * 12; // semitones
    const factor = 4 * (Math.pow(2, interval / 12) - 1) * delayTime / bufferTime;
    modGain1.gain.value = factor;
    modGain2.gain.value = factor;
  };

  setPitchOffset(0);

  return {
    input,
    output,
    setPitchOffset,
    destroy: () => {
      try { mod1.stop(); mod2.stop(); mod3.stop(); mod4.stop(); fade1.stop(); fade2.stop(); } catch {}
      try { input.disconnect(); output.disconnect(); } catch {}
    },
  };
}
