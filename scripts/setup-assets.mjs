// Fetches the MediaPipe runtime assets the app serves locally:
//  - WASM bundle: copied from node_modules/@mediapipe/tasks-vision
//  - face_landmarker.task model: downloaded from the MediaPipe model zoo
// Runs on postinstall; skips anything already present.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = join(root, "public", "mediapipe", "wasm");
const modelDst = join(root, "public", "models", "face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

if (!existsSync(join(wasmDst, "vision_wasm_internal.wasm"))) {
  mkdirSync(wasmDst, { recursive: true });
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log("gazelle: copied MediaPipe WASM to public/mediapipe/wasm");
}

if (!existsSync(modelDst)) {
  mkdirSync(dirname(modelDst), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log("gazelle: downloaded face_landmarker.task to public/models");
}
