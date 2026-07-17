// Landing screen: mode select (Desktop / VR / Passthrough AR), dataset provenance,
// settings/help access before entering a mode.
import type { App } from "../core/App";
import type { Manifest } from "../data/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Landing {
  private app: App;
  onModeSelected: ((mode: "desktop" | "vr" | "ar") => void) | null = null;

  constructor(app: App) {
    this.app = app;
  }

  async init(manifest: Manifest | null, counts: { stars: number; exoplanets: number; dso: number }) {
    // Dataset provenance line.
    const parts: string[] = [];
    if (counts.stars) parts.push(`${counts.stars.toLocaleString()} stars`);
    if (counts.exoplanets) parts.push(`${counts.exoplanets.toLocaleString()} exoplanets`);
    if (counts.dso) parts.push(`${counts.dso.toLocaleString()} deep-sky objects`);
    $("dataset-line").textContent = parts.length
      ? `Loaded: ${parts.join(" · ")} — all real catalog data`
      : "Datasets unavailable — running with procedural fallbacks";
    if (manifest) {
      const failed = manifest.datasets.filter((d) => d.status?.startsWith("FAILED") || d.status?.startsWith("FALLBACK"));
      if (failed.length) {
        $("provenance").textContent += ` · Fallbacks: ${failed.map((f) => f.name).join(", ")}`;
      }
    }

    // XR support detection.
    const [vrOK, arOK] = await Promise.all([this.app.sessionSupported("vr"), this.app.sessionSupported("ar")]);
    $("vr-status").textContent = vrOK ? "✓ headset detected" : "not available here";
    $("ar-status").textContent = arOK ? "✓ passthrough ready" : "not available here";
    ($("mode-vr") as HTMLButtonElement).disabled = !vrOK;
    ($("mode-ar") as HTMLButtonElement).disabled = !arOK;

    $("mode-desktop").onclick = () => this.choose("desktop");
    $("mode-vr").onclick = () => this.choose("vr");
    $("mode-ar").onclick = () => this.choose("ar");
    $("landing-help").onclick = () => {
      $("hud").classList.remove("hidden");
      $("panel-help").classList.remove("hidden");
      $("panel-help").querySelector(".close-btn")?.addEventListener("click", () => {
        if (!this.entered) $("hud").classList.add("hidden");
      }, { once: true });
    };
    $("landing-settings").onclick = () => {
      $("hud").classList.remove("hidden");
      $("panel-settings").classList.remove("hidden");
      $("panel-settings").querySelector(".close-btn")?.addEventListener("click", () => {
        if (!this.entered) $("hud").classList.add("hidden");
      }, { once: true });
    };
  }

  private entered = false;

  choose(mode: "desktop" | "vr" | "ar") {
    this.entered = true;
    $("landing").classList.add("hidden");
    this.onModeSelected?.(mode);
  }
}
