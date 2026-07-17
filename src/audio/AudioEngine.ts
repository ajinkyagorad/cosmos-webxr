// Procedural WebAudio: engine hum, warp riser/whoosh, UI ticks, spatialized beacon ping,
// and a calm generative ambient pad. No audio files anywhere.
import * as THREE from "three";
import { settings } from "../ui/Settings";
import { C_M_S, PC_IN_KM } from "../util/astro";

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private engineOsc1?: OscillatorNode;
  private engineOsc2?: OscillatorNode;
  private engineGain?: GainNode;
  private musicGain?: GainNode;
  private musicTimer: number | null = null;
  private beaconPanner?: PannerNode;
  private beaconGain?: GainNode;
  private started = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    this.started = true;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.get("muted") ? 0 : settings.get("masterVolume");
    this.master.connect(this.ctx.destination);

    // Procedural reverb impulse (decaying noise burst).
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.8, 2.2);
    const revGain = this.ctx.createGain();
    revGain.gain.value = 0.5;
    this.reverb.connect(revGain).connect(this.master);

    this.buildEngine();
    this.buildBeacon();
    if (settings.get("ambientMusic")) this.startMusic();

    settings.onChange((k) => {
      if (k === "masterVolume" || k === "muted") {
        this.master.gain.linearRampToValueAtTime(
          settings.get("muted") ? 0 : settings.get("masterVolume"),
          this.ctx!.currentTime + 0.1,
        );
      }
      if (k === "ambientMusic") {
        if (settings.get("ambientMusic")) this.startMusic();
        else this.stopMusic();
      }
    });
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const len = rate * seconds;
    const buf = this.ctx!.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** Engine hum: two detuned oscillators through a lowpass; pitch/volume follow speed. */
  private buildEngine() {
    const ctx = this.ctx!;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = "sawtooth";
    this.engineOsc1.frequency.value = 42;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "sine";
    this.engineOsc2.frequency.value = 63.5;
    this.engineOsc1.connect(lp);
    this.engineOsc2.connect(lp);
    lp.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineGain.connect(this.reverb);
    this.engineOsc1.start();
    this.engineOsc2.start();
  }

  /** Call every frame with current speed in world-units/s. */
  updateEngine(speedUnits: number, thrusting: boolean) {
    if (!this.ctx || !this.engineGain || !settings.get("engineSound")) {
      if (this.engineGain && this.ctx) this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      return;
    }
    const t = this.ctx.currentTime;
    // Map speed (m/s) logarithmically to pitch 40–240 Hz.
    const mps = speedUnits * PC_IN_KM * 1000;
    const cFrac = Math.min(mps / C_M_S, 1e9);
    const norm = cFrac <= 0 ? 0 : Math.min(1, Math.log10(1 + cFrac * 1e6) / 6);
    const base = 40 + norm * 200;
    const vol = thrusting ? 0.05 + norm * 0.1 : 0.015 + norm * 0.05;
    this.engineOsc1!.frequency.setTargetAtTime(base, t, 0.15);
    this.engineOsc2!.frequency.setTargetAtTime(base * 1.5 + 2, t, 0.15);
    this.engineGain.gain.setTargetAtTime(vol, t, 0.2);
  }

  /** Warp charge riser + whoosh on fire. */
  playWarpCharge(duration = 1.1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + duration);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration + 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + duration);
    osc.connect(lp).connect(g);
    g.connect(this.master); g.connect(this.reverb);
    osc.start(t); osc.stop(t + duration + 0.3);
  }

  playWarpWhoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 1.6;
    const noise = ctx.createBufferSource();
    noise.buffer = this.makeNoise(dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(180, t + dur);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noise.connect(bp).connect(g);
    g.connect(this.master); g.connect(this.reverb);
    noise.start(t);
  }

  playArrivalThump() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g); g.connect(this.master); g.connect(this.reverb);
    osc.start(t); osc.stop(t + 0.7);
  }

  playTick(freq = 1200) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.08);
  }

  /** Spatialized beacon ping near the selected target. Call with world-space direction. */
  private buildBeacon() {
    const ctx = this.ctx!;
    this.beaconPanner = ctx.createPanner();
    this.beaconPanner.panningModel = "HRTF";
    this.beaconPanner.distanceModel = "exponential";
    this.beaconPanner.refDistance = 1;
    this.beaconGain = ctx.createGain();
    this.beaconGain.gain.value = 0;
    this.beaconGain.connect(this.beaconPanner).connect(this.master);
  }

  /** Emit one beacon ping from a direction relative to the camera. */
  beaconPing(dirWorld: THREE.Vector3) {
    if (!this.ctx || !this.beaconGain || !this.beaconPanner) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.beaconPanner.positionX.value = dirWorld.x;
    this.beaconPanner.positionY.value = dirWorld.y;
    this.beaconPanner.positionZ.value = dirWorld.z;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    const g = this.beaconGain;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g);
    osc.start(t); osc.stop(t + 1);
    // Keep listener at origin facing -z (we feed world-space-ish direction; good enough).
  }

  /** Calm generative pad: detuned oscillators → lowpass → reverb, slow random chords. */
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(this.musicGain);
    this.musicGain.connect(this.master);
    this.musicGain.connect(this.reverb);
    // Slow filter LFO for gentle movement.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // Pentatonic minor chord pool (A minor pentatonic-ish, low register).
    const roots = [110, 130.81, 146.83, 164.81, 196];
    const chordShapes = [[1, 1.5, 2], [1, 1.189, 1.782], [1, 1.335, 2], [1, 1.5, 1.782]];
    let chordIdx = Math.floor(Math.random() * roots.length);
    const voices: { osc: OscillatorNode[]; gain: GainNode } = { osc: [], gain: ctx.createGain() };
    voices.gain.gain.value = 0.5;
    voices.gain.connect(lp);

    const playChord = () => {
      if (!this.ctx || !this.musicGain) return;
      const t = this.ctx.currentTime;
      // Fade out old voices.
      for (const o of voices.osc) {
        try { o.stop(t + 7); } catch { /* already stopped */ }
      }
      voices.osc = [];
      // Random walk to a nearby chord.
      chordIdx = (chordIdx + (Math.random() < 0.5 ? 1 : roots.length - 1)) % roots.length;
      const shape = chordShapes[Math.floor(Math.random() * chordShapes.length)];
      const root = roots[chordIdx] * (Math.random() < 0.3 ? 0.5 : 1);
      for (const ratio of shape) {
        for (const det of [-2.5, 0, 2.5]) {
          const o = this.ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = root * ratio;
          o.detune.value = det;
          const vg = this.ctx.createGain();
          vg.gain.setValueAtTime(0.0001, t);
          vg.gain.linearRampToValueAtTime(0.16 / shape.length, t + 4 + Math.random() * 3);
          vg.gain.linearRampToValueAtTime(0.0001, t + 14 + Math.random() * 4);
          o.connect(vg).connect(voices.gain);
          o.start(t);
          o.stop(t + 20);
          voices.osc.push(o);
        }
      }
      // Schedule next chord.
      this.musicTimer = window.setTimeout(playChord, 9000 + Math.random() * 5000);
    };
    playChord();
  }

  private stopMusic() {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 2);
      const mg = this.musicGain;
      setTimeout(() => mg.disconnect(), 3000);
      this.musicGain = undefined;
    }
  }

  private makeNoise(seconds: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const buf = this.ctx!.createBuffer(1, rate * seconds, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
