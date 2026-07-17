// Minimal WebXR ambient declarations (only what this app uses).
// The registry package @webxr/types was unreachable at build time, so these are local.

interface XRSessionInit {
  optionalFeatures?: string[];
  requiredFeatures?: string[];
}

interface XRSession extends EventTarget {
  end(): Promise<void>;
  requestReferenceSpace(type: string): Promise<XRReferenceSpace>;
  addEventListener(type: string, listener: (e: any) => void): void;
  removeEventListener(type: string, listener: (e: any) => void): void;
  inputSources: XRInputSourceArray;
}

interface XRInputSourceArray {
  length: number;
  [index: number]: XRInputSource;
}

interface XRInputSource {
  handedness: "none" | "left" | "right";
  targetRayMode: string;
  gamepad?: Gamepad;
  hand?: XRHand;
}

interface XRHand {
  get(jointName: string): XRJointSpace | undefined;
}

interface XRJointSpace {}

interface XRReferenceSpace {}

interface XRSystem {
  isSessionSupported(mode: string): Promise<boolean>;
  requestSession(mode: string, init?: XRSessionInit): Promise<XRSession>;
}

interface Navigator {
  xr?: XRSystem;
}

interface GamepadHapticActuator {
  pulse(intensity: number, duration: number): Promise<boolean>;
}

interface Gamepad {
  hapticActuators?: GamepadHapticActuator[];
}
