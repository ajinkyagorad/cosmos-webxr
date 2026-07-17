// Central settings store with localStorage persistence + change events.

export interface SettingsState {
  // comfort
  vignette: boolean;
  snapTurn: boolean;
  seated: boolean;
  turnSpeed: number; // deg/s smooth turn
  // layers
  layerStars: boolean;
  layerExoplanets: boolean;
  layerDSO: boolean;
  layerMissions: boolean;
  layerCompact: boolean;
  layerCinematic: boolean;
  // solar system
  labels: boolean;
  orbits: boolean;
  planetSizeExaggeration: number; // multiplicative on real radius vs orbit scale
  orbitExaggeration: number; // multiplicative on real AU distance vs base
  elevationExaggeration: number; // 0..10 bump/displacement scale
  // audio
  masterVolume: number; // 0..1
  muted: boolean;
  ambientMusic: boolean;
  engineSound: boolean;
}

const DEFAULTS: SettingsState = {
  vignette: true,
  snapTurn: false,
  seated: false,
  turnSpeed: 90,
  layerStars: true,
  layerExoplanets: true,
  layerDSO: true,
  layerMissions: true,
  layerCompact: true,
  layerCinematic: false,
  labels: true,
  orbits: true,
  planetSizeExaggeration: 800,
  orbitExaggeration: 1,
  elevationExaggeration: 3,
  masterVolume: 0.7,
  muted: false,
  ambientMusic: false,
  engineSound: true,
};

type Listener = (key: keyof SettingsState, value: number | boolean) => void;

const KEY = "cosmos-webxr-settings-v1";

class Settings {
  state: SettingsState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.state, JSON.parse(raw));
    } catch { /* private mode etc. */ }
  }

  get<K extends keyof SettingsState>(k: K): SettingsState[K] {
    return this.state[k];
  }

  set<K extends keyof SettingsState>(k: K, v: SettingsState[K]) {
    this.state[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
    for (const l of this.listeners) l(k, v as number | boolean);
  }

  toggle(k: keyof SettingsState) {
    this.set(k, !this.state[k] as never);
  }

  onChange(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settings = new Settings();
