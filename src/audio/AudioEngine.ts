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

  /**
   * Calm generative pad — reworked to be genuinely pleasant:
   * consonant triads only (major/minor), very slow attacks (8–14 s), chord changes every
   * 35–60 s with long crossfades, warm lowpassed triangle+sine blend, ≤1 cent detune,
   * very low default level. No abrupt onsets, ever.
   */
  private startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const ctx = this.ctx;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.gain.linearRampToValueAtTime(0.032, ctx.currentTime + 12);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 620;
    lp.Q.value = 0.4;
    lp.connect(this.musicGain);
    this.musicGain.connect(this.master);
    this.musicGain.connect(this.reverb);
    // Very slow filter LFO for gentle warmth drift.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.02;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();

    // Consonant progression: Am – F – C – G – Em – Am (all major/minor triads).
    // Roots in a low, warm register.
    const roots = [110.0, 87.31, 130.81, 98.0, 82.41, 110.0]; // A2 F2 C3 G2 E2 A2
    const qualities: number[][] = [
      [1, 1.1892, 1.4983], // minor
      [1, 1.2599, 1.4983], // major
      [1, 1.2599, 1.4983],
      [1, 1.2599, 1.4983],
      [1, 1.1892, 1.4983],
      [1, 1.1892, 1.4983],
    ];
    let chordIdx = Math.floor(Math.random() * roots.length);
    let activeVoices: { osc: OscillatorNode[]; gain: GainNode } | null = null;

    const playChord = () => {
      if (!this.ctx || !this.musicGain) return;
      const t = this.ctx.currentTime;
      // Long crossfade: release previous chord over 20 s.
      if (activeVoices) {
        const old = activeVoices;
        old.gain.gain.setTargetAtTime(0.0001, t, 6);
        for (const o of old.osc) { try { o.stop(t + 25); } catch { /* stopped */ } }
      }
      // Slow random walk through the progression.
      chordIdx = (chordIdx + (Math.random() < 0.6 ? 1 : roots.length - 1)) % roots.length;
      const root = roots[chordIdx] * (Math.random() < 0.25 ? 0.5 : 1);
      const shape = qualities[chordIdx];
      const vg = this.ctx.createGain();
      vg.gain.setValueAtTime(0.0001, t);
      vg.gain.linearRampToValueAtTime(0.6, t + 10 + Math.random() * 6); // 10–16 s attack
      vg.connect(lp);
      const oscs: OscillatorNode[] = [];
      for (const ratio of shape) {
        // Warm blend: one triangle + one sine per note, ≤1 cent apart.
        for (const [type, det, lvl] of [["triangle", -1, 0.5], ["sine", 1, 0.7]] as const) {
          const o = this.ctx.createOscillator();
          o.type = type as OscillatorType;
          o.frequency.value = root * ratio;
          o.detune.value = det;
          const og = this.ctx.createGain();
          og.gain.value = lvl / shape.length;
          o.connect(og).connect(vg);
          o.start(t);
          oscs.push(o);
        }
      }
      activeVoices = { osc: oscs, gain: vg };
      // Next chord in 35–60 s.
      this.musicTimer = window.setTimeout(playChord, 35000 + Math.random() * 25000);
    };
    playChord();
  }

  private stopMusic() {
    if (this.musicTimer !== null) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 4);
      const mg = this.musicGain;
      setTimeout(() => mg.disconnect(), 8000);
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
