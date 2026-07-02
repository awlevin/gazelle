// Per-frame gaze features from a MediaPipe FaceLandmarker result:
//  - 8 eye-direction blendshapes (eyeLookIn/Out/Up/Down, both eyes)
//  - normalized iris position within each eye's corners/lids (+ squared terms
//    for mild nonlinearity)
//  - head pose from the facial transformation matrix (rotation z-axis
//    components + translation), so the model separates eye rotation from
//    head movement.
// The ridge model learns the mapping, so only consistency matters — not the
// semantic correctness of any single term.

import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

export type GazeFrame = {
  features: number[] | null;
  blink: boolean;
  /** max of the two eyeBlink blendshape scores, 0..1 — for stricter filtering */
  blinkScore: number;
  faceDetected: boolean;
  t: number;
};

const LOOK_SHAPES = [
  "eyeLookDownLeft",
  "eyeLookDownRight",
  "eyeLookInLeft",
  "eyeLookInRight",
  "eyeLookOutLeft",
  "eyeLookOutRight",
  "eyeLookUpLeft",
  "eyeLookUpRight",
];

// Canonical face-mesh indices
const EYES = [
  { corner1: 33, corner2: 133, lidTop: 159, lidBottom: 145, iris: 468 },
  { corner1: 362, corner2: 263, lidTop: 386, lidBottom: 374, iris: 473 },
];

export function extractFeatures(result: FaceLandmarkerResult, t: number): GazeFrame {
  const landmarks = result.faceLandmarks?.[0];
  const shapes = result.faceBlendshapes?.[0]?.categories;
  if (!landmarks || landmarks.length < 478 || !shapes) {
    return { features: null, blink: false, blinkScore: 0, faceDetected: false, t };
  }

  const shapeMap = new Map<string, number>();
  for (const c of shapes) shapeMap.set(c.categoryName, c.score);

  const blinkScore = Math.max(
    shapeMap.get("eyeBlinkLeft") ?? 0,
    shapeMap.get("eyeBlinkRight") ?? 0
  );
  const blink = blinkScore > 0.45;

  const features: number[] = [];
  for (const name of LOOK_SHAPES) features.push(shapeMap.get(name) ?? 0);

  // Iris offset within each eye, projected onto the corner-to-corner axis (u)
  // and the lid-to-lid axis (v). Robust to head roll for u; v is approximate.
  for (const eye of EYES) {
    const c1 = landmarks[eye.corner1];
    const c2 = landmarks[eye.corner2];
    const top = landmarks[eye.lidTop];
    const bot = landmarks[eye.lidBottom];
    const iris = landmarks[eye.iris];

    const ax = c2.x - c1.x;
    const ay = c2.y - c1.y;
    const alen2 = ax * ax + ay * ay || 1e-9;
    const u = ((iris.x - c1.x) * ax + (iris.y - c1.y) * ay) / alen2;

    const vspan = bot.y - top.y || 1e-9;
    const v = (iris.y - top.y) / vspan;

    features.push(u, v, u * u, v * v);
  }

  // Head pose: transformation matrix is column-major 4x4. Rotation basis
  // components (yaw/pitch/roll information) plus translation. The calibration
  // includes a head-sway pass specifically so these terms get enough variance
  // for the regression to learn head compensation.
  const m = result.facialTransformationMatrixes?.[0]?.data;
  if (m && m.length === 16) {
    features.push(m[0], m[1], m[4], m[5], m[8], m[9], m[12], m[13], m[14]);
  } else {
    features.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  return { features, blink, blinkScore, faceDetected: true, t };
}
