// One-Euro filter (Casiez et al. 2012) — low-latency smoothing for noisy
// pointing signals. Tuned for webcam gaze: heavy smoothing at rest, fast
// response during saccades.

class LowPass {
  private s: number | undefined;

  filter(x: number, alpha: number): number {
    this.s = this.s === undefined ? x : alpha * x + (1 - alpha) * this.s;
    return this.s;
  }

  get last(): number | undefined {
    return this.s;
  }

  reset() {
    this.s = undefined;
  }
}

export class OneEuro {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | undefined;

  constructor(
    private minCutoff = 1.2, // Hz — lower = smoother at rest
    private beta = 0.3, // speed coefficient — higher = snappier saccades
    private dCutoff = 1.5
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.lastT === undefined) {
      this.lastT = tMs;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;

    const prev = this.x.last ?? value;
    const rawDeriv = (value - prev) / dt;
    const deriv = this.dx.filter(rawDeriv, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(deriv);
    return this.x.filter(value, this.alpha(cutoff, dt));
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastT = undefined;
  }
}
