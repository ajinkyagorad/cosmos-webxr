// Ambient declaration for troika-three-text (no bundled types in this version).
declare module "troika-three-text" {
  import type { Object3D } from "three";
  export class Text extends Object3D {
    text: string;
    fontSize: number;
    color: number | string;
    anchorX: string | number;
    anchorY: string | number;
    outlineWidth: number;
    outlineColor: number | string;
    outlineOpacity: number;
    sync(): void;
    dispose(): void;
  }
}
