// Desktop DOM HUD: speed readout, target panel, destinations/layers/settings panels, help.
import * as THREE from "three";
import type { App } from "../core/App";
import type { Navigation } from "../controls/Navigation";
import type { Selection, Selectable } from "../scene/Selection";
import { settings, type SettingsState } from "../ui/Settings";
import { formatSpeed, formatDistancePC, esc } from "../util/astro";
import type { AudioEngine } from "../audio/AudioEngine";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class HUD {
  private app: App;
  private nav: Navigation;
  private selection: Selection;
  private audio: AudioEngine;
  private destinations: { name: string; cat: string; sel: Selectable; distPC?: number }[] = [];
  private beaconTimer = 0;

  constructor(app: App, nav: Navigation, selection: Selection, audio: AudioEngine) {
    this.app = app;
    this.nav = nav;
    this.selection = selection;
    this.audio = audio;
    this.wirePanels();
    this.wireTarget();
    selection.onTargetChanged = (s) => this.showTarget(s);
    nav.onJumpProgress = (state, charge) => {
      $("jump-progress").classList.toggle("hidden", state === "idle");
      $("jump-progress-fill").style.width = `${Math.round(charge * 100)}%`;
    };
  }

  show() { $("hud").classList.remove("hidden"); }

  setHint(text: string) { $("hud-hint").textContent = text; }

  addDestinations(items: { name: string; cat: string; sel: Selectable; distPC?: number }[]) {
    this.destinations.push(...items);
    this.renderDestinations();
  }

  private wirePanels() {
    const toggle = (id: string) => {
      const el = $(id);
      const wasHidden = el.classList.contains("hidden");
      document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
      if (wasHidden) { el.classList.remove("hidden"); this.audio.playTick(900); }
    };
    $("btn-help").onclick = () => toggle("panel-help");
    $("btn-destinations").onclick = () => toggle("panel-destinations");
    $("btn-layers").onclick = () => toggle("panel-layers");
    $("btn-settings").onclick = () => toggle("panel-settings");
    $("btn-mute").onclick = () => {
      settings.toggle("muted");
      $("btn-mute").classList.toggle("active", settings.get("muted"));
    };
    $("btn-home").onclick = () => { this.nav.goHome(); this.audio.playTick(1100); };
    $("btn-back").onclick = () => {
      if (!this.nav.goBack()) this.setHint("No breadcrumbs yet — travel or jump first");
      else this.audio.playTick(1100);
    };
    document.querySelectorAll(".close-btn").forEach((b) => {
      b.addEventListener("click", () => $( (b as HTMLElement).dataset.close! ).classList.add("hidden"));
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyH") toggle("panel-help");
      if (e.code === "KeyD") toggle("panel-destinations");
      if (e.code === "KeyL") toggle("panel-layers");
      if (e.code === "KeyM") $("btn-mute").click();
      if (e.code === "Escape") document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
    });
    this.renderLayers();
    this.renderSettings();
  }

  private wireTarget() {
    $("btn-jump").onclick = () => {
      if (this.selection.target) {
        this.audio.playWarpCharge(1.1);
        this.nav.startCharge(this.selection.target);
      }
    };
    $("btn-clear-target").onclick = () => this.selection.clear();
  }

  private showTarget(s: Selectable | null) {
    $("hud-target").classList.toggle("hidden", !s);
    $("reticle").classList.toggle("locked", !!s);
    if (s) {
      $("target-name").textContent = s.name;
      $("target-info").innerHTML = s.describe();
      this.audio.playTick(1400);
    }
  }

  private renderDestinations() {
    const host = $("destinations-list");
    host.innerHTML = "";
    const groups = new Map<string, typeof this.destinations>();
    for (const d of this.destinations) {
      if (!groups.has(d.cat)) groups.set(d.cat, []);
      groups.get(d.cat)!.push(d);
    }
    for (const [cat, items] of groups) {
      const title = document.createElement("div");
      title.className = "dest-group-title";
      title.textContent = cat;
      host.appendChild(title);
      for (const d of items) {
        const el = document.createElement("div");
        el.className = "dest-item";
        el.innerHTML = `<span>${esc(d.name)}</span><span class="dest-dist">${d.distPC !== undefined ? formatDistancePC(d.distPC) : ""}</span>`;
        el.onclick = () => {
          this.selection.select(d.sel);
          document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
          this.setHint(`Target: ${d.name} — press J (hold) to jump`);
        };
        host.appendChild(el);
      }
    }
  }

  private renderLayers() {
    const host = $("layers-list");
    const layers: { key: keyof SettingsState; label: string }[] = [
      { key: "layerStars", label: "Stars (HYG / Gaia)" },
      { key: "layerDust", label: "3D dust volume (Leike/Lallement)" },
      { key: "layerCepheids", label: "Cepheids — disk map (Skowron+2019)" },
      { key: "layerGlobulars", label: "Globular clusters (Harris/LVDB)" },
      { key: "layerGalaxies", label: "Local Group galaxies (LVDB)" },
      { key: "layerConstellations", label: "Constellation figures" },
      { key: "layerExoplanets", label: "Exoplanets (NASA Archive)" },
      { key: "layerDSO", label: "Deep-sky objects (OpenNGC)" },
      { key: "layerMissions", label: "Missions & probes" },
      { key: "layerCompact", label: "Black holes & neutron stars" },
      { key: "layerSkybox", label: "Sky backdrop (Gaia all-sky)" },
      { key: "layerCinematic", label: "✦ Cinematic universes (fiction)" },
      { key: "labels", label: "Labels" },
      { key: "starNames", label: "Star names on hover" },
      { key: "orbits", label: "Orbit lines" },
    ];
    host.innerHTML = "";
    for (const l of layers) {
      const el = document.createElement("label");
      el.className = "layer-item";
      el.innerHTML = `<span>${l.label}</span><input type="checkbox" ${settings.get(l.key) ? "checked" : ""}>`;
      el.querySelector("input")!.addEventListener("change", (e) => {
        settings.set(l.key, (e.target as HTMLInputElement).checked as never);
        this.audio.playTick(1000);
      });
      host.appendChild(el);
    }
  }

  private renderSettings() {
    const host = $("settings-list");
    host.innerHTML = "";
    const bool = (key: keyof SettingsState, label: string) => {
      const el = document.createElement("label");
      el.className = "setting-item";
      el.innerHTML = `<span>${label}</span><input type="checkbox" ${settings.get(key) ? "checked" : ""}>`;
      el.querySelector("input")!.addEventListener("change", (e) =>
        settings.set(key, (e.target as HTMLInputElement).checked as never));
      host.appendChild(el);
    };
    const range = (key: keyof SettingsState, label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const el = document.createElement("div");
      el.className = "setting-item";
      el.innerHTML = `<span>${label}</span><span style="display:flex;gap:8px;align-items:center">
        <input type="range" min="${min}" max="${max}" step="${step}" value="${settings.get(key)}">
        <span class="setting-value">${fmt(settings.get(key) as number)}</span></span>`;
      const input = el.querySelector("input")!;
      const val = el.querySelector(".setting-value")!;
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        settings.set(key, v as never);
        val.textContent = fmt(v);
      });
      host.appendChild(el);
    };
    bool("vignette", "Comfort vignette (high speed)");
    bool("snapTurn", "Snap turn (VR)");
    bool("seated", "Seated mode (VR)");
    range("turnSpeed", "Turn speed", 30, 180, 5, (v) => `${v}°/s`);
    range("planetSizeExaggeration", "Planet size exaggeration", 50, 3000, 50, (v) => `${v}×`);
    range("orbitExaggeration", "Orbit distance exaggeration", 0.25, 4, 0.05, (v) => `${v.toFixed(2)}×`);
    range("elevationExaggeration", "Terrain elevation exaggeration", 0, 10, 0.5, (v) => `${v.toFixed(1)}×`);
    range("masterVolume", "Master volume", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    bool("muted", "Mute all audio");
    bool("engineSound", "Engine hum");
    bool("ambientMusic", "Ambient generative music");
    bool("layerCinematic", "✦ Cinematic universes (fictional overlay)");
  }

  /** Per-frame HUD refresh (speed readout, beacon ping). */
  update(dt: number) {
    const kmPerUnit = this.nav.kmPerUnit;
    const s = formatSpeed(this.nav.speedUnits, kmPerUnit);
    $("speed-value").textContent = s.value;
    $("speed-sub").textContent = s.sub;
    // Beacon ping while a target is selected (every 1.4 s).
    if (this.selection.target) {
      this.beaconTimer -= dt;
      if (this.beaconTimer <= 0) {
        this.beaconTimer = 1.4;
        const tp = this.selection.getWorldPosition(this.selection.target, new THREE.Vector3());
        const cp = this.app.camera.getWorldPosition(new THREE.Vector3());
        const dir = tp.sub(cp).normalize();
        this.audio.beaconPing(dir);
      }
    }
  }
}
