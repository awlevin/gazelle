// A camera-free gaze source for demos and development.
//
// IMPORTANT: this is NOT eye tracking. Nothing here looks at a face. It is a
// synthetic scanpath generator that plays the role of the calibrated gaze
// estimate so the reader can be driven — and watched — without a webcam.
// Everything downstream (landing detection, drift nudges, regression and skip
// counting, WPM) is the real production code path; only the eyes are fake.
//
// Enabled by `?demo=1`, and the UI must say so on screen while it runs.
//
// The scanpath is modelled the way reading actually looks: ballistic saccades
// of 30–60 ms between fixations of 200–320 ms, a small landing error around
// each target, tremor and slow drift during the fixation, and an occasional
// regression back to a word already read.

import { GazeEngine, type GazePoint } from "./engine";

/** A fixation the scanpath has already made, in page coordinates. */
type Landing = { x: number; y: number; scrollY: number };

const SACCADE_MS = [32, 58] as const;
const FIXATION_MS = [200, 320] as const;
const REGRESSION_MS = [380, 460] as const;
/** Fixations between regressions — real readers regress on ~10–15% of saccades. */
const REGRESSION_EVERY = [8, 12] as const;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** Box–Muller, so landing error is Gaussian rather than boxy. */
const gauss = (sd: number) =>
  sd * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export class DemoGazeEngine extends GazeEngine {
  /** No model is fitted, but the reader can be driven, so skip calibration. */
  get calibrated(): boolean {
    return true;
  }

  private from = { x: 0, y: 0 };
  private to = { x: 0, y: 0 };
  private phase: "saccade" | "fixation" = "fixation";
  private phaseStart = 0;
  private phaseMs = 400;
  private history: Landing[] = [];
  private sinceRegression = 0;
  private regressionDue = Math.round(rand(...REGRESSION_EVERY));
  private driftPhase = Math.random() * Math.PI * 2;
  private pendingDwell = 300;

  /** Ignores the video element: no camera is opened. */
  async init(): Promise<void> {
    this.from = { x: window.innerWidth * 0.3, y: window.innerHeight * 0.45 };
    this.to = { ...this.from };
    this.phaseStart = performance.now();
    this.running = true;
    this.loop();
  }

  /** Centre of the word the reader is asking the eyes to land on next. */
  private nextTarget(): { x: number; y: number } | null {
    const el = document.querySelector<HTMLElement>('[data-gaze-target="next"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Pick where the eyes go next: usually the next word, sometimes backwards. */
  private plan(now: number) {
    this.from = { ...this.to };
    const back = this.history[this.history.length - 4];

    if (this.sinceRegression >= this.regressionDue && back) {
      // Regress: look back at a word read a few fixations ago and dwell there
      // long enough for the reader to notice. Stored landings are viewport
      // coordinates, so undo any scrolling since.
      this.to = { x: back.x + gauss(18), y: back.y - (window.scrollY - back.scrollY) + gauss(10) };
      this.phase = "saccade";
      this.phaseStart = now;
      this.phaseMs = rand(...SACCADE_MS);
      this.sinceRegression = 0;
      this.regressionDue = Math.round(rand(...REGRESSION_EVERY));
      this.pendingDwell = rand(...REGRESSION_MS);
      return;
    }

    const target = this.nextTarget();
    if (!target) {
      // Nothing to read: hold still.
      this.phase = "fixation";
      this.phaseStart = now;
      this.phaseMs = 300;
      return;
    }
    // Land near the word, not on it — webcam gaze is a coin-sized blur, and
    // the reader is built to tolerate that.
    this.to = { x: target.x + gauss(26), y: target.y + gauss(14) };
    this.phase = "saccade";
    this.phaseStart = now;
    this.phaseMs = rand(...SACCADE_MS);
    this.pendingDwell = rand(...FIXATION_MS);
    this.history.push({ x: this.to.x, y: this.to.y, scrollY: window.scrollY });
    if (this.history.length > 12) this.history.shift();
    this.sinceRegression++;
  }

  protected loop = () => {
    if (!this.running) return;
    const t = performance.now();
    const u = Math.min(1, (t - this.phaseStart) / this.phaseMs);

    let x: number;
    let y: number;
    if (this.phase === "saccade") {
      // Ease out with a slight overshoot, then settle — saccades routinely
      // overshoot and need a corrective glide.
      const e = 1 - Math.pow(1 - u, 3);
      const overshoot = Math.sin(Math.PI * u) * 0.06;
      const k = e + overshoot * (1 - e);
      x = this.from.x + (this.to.x - this.from.x) * k;
      y = this.from.y + (this.to.y - this.from.y) * k;
      if (u >= 1) {
        this.phase = "fixation";
        this.phaseStart = t;
        this.phaseMs = this.pendingDwell;
      }
    } else {
      x = this.to.x;
      y = this.to.y;
      if (u >= 1) this.plan(t);
    }

    // Tracker character: slow drift plus per-frame jitter, so the dot reads as
    // an estimate rather than a cursor.
    const drift = t / 1000 + this.driftPhase;
    x += Math.sin(drift * 0.7) * 9 + gauss(3.5);
    y += Math.cos(drift * 0.5) * 6 + gauss(2.5);

    const frame = { features: null, blink: false, blinkScore: 0, faceDetected: true, t };
    this.latestFrame = frame;
    for (const cb of this.frameListeners) cb(frame);

    const p: GazePoint = { x, y, t };
    this.latestGaze = p;
    for (const cb of this.gazeListeners) cb(p);

    this.rafId = requestAnimationFrame(this.loop);
  };
}
