// GazeEngine: owns the camera stream, the MediaPipe FaceLandmarker, the
// calibration model, and smoothing. Emits two streams: raw per-frame features
// (for calibration) and smoothed screen-space gaze points (for reading).

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { extractFeatures, type GazeFrame } from "./features";
import { GazeModel, type CalibrationSample } from "./ridge";
import { OneEuro } from "./oneEuro";

export type GazePoint = { x: number; y: number; t: number };

export class GazeEngine {
  readonly model = new GazeModel();

  private landmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private running = false;
  private rafId = 0;
  private lastVideoTime = -1;

  private fx = new OneEuro(1.0, 0.35);
  private fy = new OneEuro(1.0, 0.35);

  // Drift correction: a translation applied after the fitted model, adapted
  // online from moments when we know where the user is actually looking
  // (spacebar sync, gaze-triggered advances). Head movement after calibration
  // shows up almost entirely as translation, so this cheap correction buys a
  // lot of stability without refitting.
  private offsetX = 0;
  private offsetY = 0;

  private frameListeners = new Set<(f: GazeFrame) => void>();
  private gazeListeners = new Set<(p: GazePoint) => void>();

  latestFrame: GazeFrame | null = null;
  latestGaze: GazePoint | null = null;

  async init(video: HTMLVideoElement): Promise<void> {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
      runningMode: "VIDEO" as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = this.stream;
    await video.play();
    this.video = video;

    this.running = true;
    this.loop();
  }

  private loop = () => {
    if (!this.running || !this.video || !this.landmarker) return;
    const video = this.video;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const t = performance.now();
      const result = this.landmarker.detectForVideo(video, t);
      const frame = extractFeatures(result, t);
      this.latestFrame = frame;
      for (const cb of this.frameListeners) cb(frame);

      if (frame.features && !frame.blink && this.model.fitted) {
        const raw = this.model.predict(frame.features);
        if (raw) {
          const p = {
            x: this.fx.filter(raw.x, t) + this.offsetX,
            y: this.fy.filter(raw.y, t) + this.offsetY,
            t,
          };
          this.latestGaze = p;
          for (const cb of this.gazeListeners) cb(p);
        }
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  onFrame(cb: (f: GazeFrame) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onGaze(cb: (p: GazePoint) => void): () => void {
    this.gazeListeners.add(cb);
    return () => this.gazeListeners.delete(cb);
  }

  /** Fit the calibration model. Returns RMS training error in px. */
  calibrate(samples: CalibrationSample[]): number {
    const rms = this.model.fit(samples);
    this.fx.reset();
    this.fy.reset();
    this.offsetX = 0;
    this.offsetY = 0;
    return rms;
  }

  /**
   * Nudge the drift correction toward a known fixation. (errX, errY) is
   * (true position − predicted position). `alpha` sets how much of the error
   * to absorb; each step is clamped, and the total offset is bounded so a few
   * bad signals can't wreck the model.
   */
  nudge(errX: number, errY: number, alpha: number, maxStep: number) {
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    this.offsetX = clamp(this.offsetX + clamp(errX * alpha, maxStep), 400);
    this.offsetY = clamp(this.offsetY + clamp(errY * alpha, maxStep), 400);
  }

  get ready(): boolean {
    return this.landmarker !== null && this.video !== null;
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.landmarker?.close();
    this.landmarker = null;
    this.stream = null;
    this.video = null;
    this.frameListeners.clear();
    this.gazeListeners.clear();
  }
}
