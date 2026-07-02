// Ridge-regression gaze model: maps a per-frame feature vector (iris offsets,
// eye blendshapes, head pose) to a screen coordinate. Features are
// standardized before fitting; a bias term is appended after scaling.

export type CalibrationSample = {
  features: number[];
  x: number;
  y: number;
};

/** Solve A·w = b for multiple right-hand sides via Gaussian elimination with partial pivoting. */
function solve(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0].length;
  // Augment
  const M = A.map((row, i) => [...row, ...B[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    if (Math.abs(p) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      for (let c = col; c < n + m; c++) M[r][c] -= f * M[col][c];
    }
  }
  const W: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p = M[i][i];
    W.push(B[0].map((_, j) => (Math.abs(p) < 1e-12 ? 0 : M[i][n + j] / p)));
  }
  return W;
}

export class GazeModel {
  private mean: number[] = [];
  private std: number[] = [];
  private weights: number[][] = []; // (d+1) x 2

  /** Fit on calibration samples. Returns RMS error in px over the training set. */
  fit(samples: CalibrationSample[], lambda = 0.05): number {
    const d = samples[0].features.length;
    const n = samples.length;

    this.mean = new Array(d).fill(0);
    this.std = new Array(d).fill(0);
    for (const s of samples) for (let j = 0; j < d; j++) this.mean[j] += s.features[j] / n;
    for (const s of samples)
      for (let j = 0; j < d; j++) this.std[j] += (s.features[j] - this.mean[j]) ** 2 / n;
    for (let j = 0; j < d; j++) this.std[j] = Math.sqrt(this.std[j]) || 1;

    const X = samples.map((s) => [...s.features.map((v, j) => (v - this.mean[j]) / this.std[j]), 1]);
    const Y = samples.map((s) => [s.x, s.y]);
    const dim = d + 1;

    const XtX: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
    const XtY: number[][] = Array.from({ length: dim }, () => [0, 0]);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < dim; a++) {
        for (let b = 0; b < dim; b++) XtX[a][b] += X[i][a] * X[i][b];
        XtY[a][0] += X[i][a] * Y[i][0];
        XtY[a][1] += X[i][a] * Y[i][1];
      }
    }
    // Regularize (skip the bias term)
    for (let a = 0; a < d; a++) XtX[a][a] += lambda * n;

    this.weights = solve(XtX, XtY);

    let sq = 0;
    for (let i = 0; i < n; i++) {
      const p = this.predict(samples[i].features)!;
      sq += (p.x - Y[i][0]) ** 2 + (p.y - Y[i][1]) ** 2;
    }
    return Math.sqrt(sq / n);
  }

  get fitted(): boolean {
    return this.weights.length > 0;
  }

  predict(features: number[]): { x: number; y: number } | null {
    if (!this.fitted) return null;
    let x = this.weights[features.length][0];
    let y = this.weights[features.length][1];
    for (let j = 0; j < features.length; j++) {
      const z = (features[j] - this.mean[j]) / this.std[j];
      x += z * this.weights[j][0];
      y += z * this.weights[j][1];
    }
    return { x, y };
  }

  reset() {
    this.weights = [];
  }
}
