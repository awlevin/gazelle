"use client";

// Smooth-pursuit calibration: one dot glides through a serpentine path over
// the whole screen (with brief holds at the corners of each sweep) while we
// pair gaze features with the dot's position continuously. Compared to a
// 9-point calibration this collects ~400 samples with full screen coverage
// instead of ~270 clustered at 9 spots. Eyes trail a moving target, so each
// frame is paired with where the dot was ~120ms earlier.

import { useEffect, useRef, useState } from "react";
import type { GazeEngine } from "@/lib/gaze/engine";
import type { CalibrationSample } from "@/lib/gaze/ridge";

const COLS = [0.08, 0.5, 0.92];
const ROWS = [0.1, 0.37, 0.63, 0.9];
const ANCHORS: [number, number][] = ROWS.flatMap((y, r) =>
  COLS.map((_, c): [number, number] => [r % 2 === 0 ? COLS[c] : COLS[2 - c], y])
);

// Second pass: a shorter path followed while gently swaying the head. Without
// it, head-pose features have no variance during calibration and the model
// cannot learn to separate "eyes moved" from "head moved".
const SWAY_ROWS = [0.22, 0.5, 0.78];
const SWAY_ANCHORS: [number, number][] = SWAY_ROWS.flatMap((y, r) =>
  COLS.map((_, c): [number, number] => [r % 2 === 0 ? COLS[c] : COLS[2 - c], y])
);

const HOLD_MS = 500;
const GLIDE_PX_PER_S = 550; // slow enough for smooth pursuit (well under saccade territory)
const LAG_MS = 120; // how far the eye trails a gliding target
const LEAD_IN_MS = 1200; // settle on the first anchor before sampling starts
const REST_MS = 2600; // mid-pass blink break: dot holds, sampling stops
const BLINK_REJECT = 0.25; // stricter than the reader: even half-closed lids corrupt samples
const POST_BLINK_MS = 250; // gaze needs a beat to re-acquire the dot after a blink

type Segment = {
  t0: number;
  t1: number;
  from: [number, number];
  to: [number, number];
  rest?: boolean;
};

type Phase = "intro" | "track" | "swayIntro" | "sway" | "done";

function easeInOutQuad(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
}

function buildTimeline(
  anchors: [number, number][],
  w: number,
  h: number
): { segments: Segment[]; total: number } {
  const segments: Segment[] = [];
  const restAt = Math.floor(anchors.length / 2);
  let t = LEAD_IN_MS;
  for (let i = 0; i < anchors.length; i++) {
    segments.push({ t0: t, t1: t + HOLD_MS, from: anchors[i], to: anchors[i] });
    t += HOLD_MS;
    if (i === restAt) {
      segments.push({ t0: t, t1: t + REST_MS, from: anchors[i], to: anchors[i], rest: true });
      t += REST_MS;
    }
    if (i + 1 < anchors.length) {
      const [x0, y0] = anchors[i];
      const [x1, y1] = anchors[i + 1];
      const dist = Math.hypot((x1 - x0) * w, (y1 - y0) * h);
      const dur = Math.max(400, (dist / GLIDE_PX_PER_S) * 1000);
      segments.push({ t0: t, t1: t + dur, from: anchors[i], to: anchors[i + 1] });
      t += dur;
    }
  }
  return { segments, total: t };
}

function posAt(
  segments: Segment[],
  t: number,
  w: number,
  h: number
): { x: number; y: number; rest: boolean } {
  const first = segments[0];
  if (t <= first.t0) return { x: first.from[0] * w, y: first.from[1] * h, rest: false };
  for (const s of segments) {
    if (t <= s.t1) {
      const u = s.t1 === s.t0 ? 1 : easeInOutQuad((t - s.t0) / (s.t1 - s.t0));
      return {
        x: (s.from[0] + (s.to[0] - s.from[0]) * u) * w,
        y: (s.from[1] + (s.to[1] - s.from[1]) * u) * h,
        rest: !!s.rest,
      };
    }
  }
  const last = segments[segments.length - 1];
  return { x: last.to[0] * w, y: last.to[1] * h, rest: false };
}

function quality(rms: number): { label: string; note: string } {
  if (rms < 85) return { label: "Sharp", note: "Tracking is solid. Words will respond cleanly." };
  if (rms < 150)
    return {
      label: "Workable",
      note: "Good enough to read with. While reading, tap space whenever the mark lags behind your eyes — each tap retunes the tracker.",
    };
  return {
    label: "Blurry",
    note: "Tracking is rough — more light on your face and a steadier head will help. A redo is recommended.",
  };
}

export default function Calibration({
  engine,
  onDone,
  onCancel,
  onPreviewChange,
}: {
  engine: GazeEngine;
  onDone: (rmsPx: number) => void;
  onCancel: () => void;
  /** Whether the page should show the camera preview right now */
  onPreviewChange?: (visible: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [progress, setProgress] = useState(0);
  const [faceLost, setFaceLost] = useState(false);
  const [resting, setResting] = useState(false);
  const [rms, setRms] = useState<number | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const allSamples = useRef<CalibrationSample[]>([]);

  // The preview matters on the intro cards (check your framing) and whenever
  // the tracker loses the face — but never while the dot is gliding, where it
  // would sit on the dot's path.
  useEffect(() => {
    onPreviewChange?.(phase === "intro" || phase === "swayIntro" || (faceLost && phase !== "done"));
  }, [phase, faceLost, onPreviewChange]);

  // Keep the face indicator live on the intro cards too
  useEffect(() => {
    if (phase !== "intro" && phase !== "swayIntro") return;
    return engine.onFrame((f) => setFaceLost(!f.faceDetected));
  }, [phase, engine]);

  useEffect(() => {
    if (phase !== "track" && phase !== "sway") return;
    let raf = 0;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { segments, total } = buildTimeline(phase === "track" ? ANCHORS : SWAY_ANCHORS, w, h);
    const start = performance.now();
    const samples: CalibrationSample[] = [];
    // Ring buffer of recent dot positions for eye-lag pairing
    const trail: { t: number; x: number; y: number; rest: boolean }[] = [];
    let lastFrameT = -1;
    let lastProgressUpdate = 0;
    let lastBlinkT = -Infinity;
    let wasResting = false;

    const loop = () => {
      const now = performance.now();
      const t = now - start;
      const pos = posAt(segments, t, w, h);

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${pos.x - 14}px, ${pos.y - 14}px, 0)`;
      }
      if (pos.rest !== wasResting) {
        wasResting = pos.rest;
        setResting(pos.rest);
      }
      trail.push({ t: now, x: pos.x, y: pos.y, rest: pos.rest });
      if (trail.length > 90) trail.shift();

      const frame = engine.latestFrame;
      if (frame && frame.t !== lastFrameT) {
        lastFrameT = frame.t;
        setFaceLost(!frame.faceDetected);
        // Even half-closed lids corrupt iris features, and gaze takes a beat
        // to re-acquire the dot after a blink — reject both.
        if (frame.blinkScore > BLINK_REJECT) lastBlinkT = frame.t;
        const blinkSafe = frame.t - lastBlinkT > POST_BLINK_MS;
        if (frame.features && blinkSafe && t > LEAD_IN_MS) {
          // Pair this frame with where the dot was LAG_MS ago
          const targetT = frame.t - LAG_MS;
          let best = trail[0];
          for (let i = trail.length - 1; i >= 0; i--) {
            if (trail[i].t <= targetT) {
              best = trail[i];
              break;
            }
          }
          if (best && !best.rest) {
            samples.push({ features: frame.features, x: best.x, y: best.y });
          }
        }
      }

      if (now - lastProgressUpdate > 150) {
        lastProgressUpdate = now;
        setProgress(Math.min(t / total, 1));
      }

      if (t >= total) {
        if (samples.length < 60) {
          // Face was lost for most of the run — start over
          onCancel();
          return;
        }
        allSamples.current.push(...samples);
        if (phase === "track") {
          setProgress(0);
          setPhase("swayIntro");
        } else {
          const err = engine.calibrate(allSamples.current);
          setRms(err);
          setPhase("done");
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, engine, onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if ((e.key === " " || e.key === "Enter") && (phase === "intro" || phase === "swayIntro")) {
        e.preventDefault();
        setPhase(phase === "intro" ? "track" : "sway");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, phase]);

  if (phase === "intro" || phase === "swayIntro") {
    const isFirst = phase === "intro";
    return (
      <div className="fixed inset-0 z-50 bg-paper flex items-center justify-center">
        <div className="max-w-md px-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
            Calibration · pass {isFirst ? "1" : "2"} of 2
          </p>
          <p className="mt-6 font-serif italic text-4xl leading-tight text-ink">
            {isFirst ? "Follow the gliding dot with your eyes." : "Same dot — now sway your head gently."}
          </p>
          <p className="mt-5 text-base leading-relaxed text-ink/80">
            {isFirst
              ? "Keep your head comfortably still and track the dot wherever it goes. About twenty seconds."
              : "Keep your eyes on the dot while your head drifts a little, like nodding along to slow music. This teaches Gazelle to tell your eyes from your head."}
          </p>
          <p className="mt-3 font-mono text-xs leading-relaxed text-fade">
            Blink freely — blinks are detected and skipped, and the dot takes a
            blink break halfway through. No need to stare.
          </p>
          {isFirst && faceLost && (
            <p className="mt-4 font-mono text-xs text-gaze">
              Can&apos;t see your face yet — check the preview in the corner.
            </p>
          )}
          <button
            onClick={() => setPhase(isFirst ? "track" : "sway")}
            className="mt-10 rounded-full bg-moss px-8 py-2.5 font-mono text-sm text-paper hover:bg-ink transition-colors"
          >
            {isFirst ? "Begin" : "Continue"}
          </button>
          <p className="mt-4 font-mono text-[11px] text-fade">space to start · esc to cancel</p>
        </div>
      </div>
    );
  }

  if (phase === "done" && rms !== null) {
    const q = quality(rms);
    return (
      <div className="fixed inset-0 z-50 bg-paper flex items-center justify-center">
        <div className="max-w-md px-8 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
            Calibration complete
          </p>
          <p className="mt-6 font-serif italic text-6xl text-ink">{q.label}</p>
          <p className="mt-3 font-mono text-xs text-fade">
            average error ±{Math.round(rms)}px
          </p>
          <p className="mt-6 text-base leading-relaxed text-ink/80">{q.note}</p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <button
              onClick={() => onDone(rms)}
              className="rounded-full bg-moss px-6 py-2.5 font-mono text-sm text-paper hover:bg-ink transition-colors"
            >
              Continue
            </button>
            <button
              onClick={() => {
                engine.model.reset();
                allSamples.current = [];
                setRms(null);
                setProgress(0);
                setPhase("track");
              }}
              className="rounded-full border border-ink/20 px-6 py-2.5 font-mono text-sm text-ink hover:border-ink/50 transition-colors"
            >
              Redo
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-paper cursor-none">
      <div className="absolute top-10 inset-x-0 text-center pointer-events-none">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
          Calibration · pass {phase === "track" ? "1" : "2"} of 2
        </p>
        <p className="mt-2 font-serif italic text-xl text-ink">
          {resting
            ? "Blink break — rest your eyes a moment"
            : phase === "track"
              ? "Head still · eyes on the dot"
              : "Sway gently · eyes on the dot"}
        </p>
        {faceLost && (
          <p className="mt-3 font-mono text-xs text-gaze">
            Can&apos;t see your face — check the preview in the corner.
          </p>
        )}
      </div>

      <div ref={dotRef} className="absolute left-0 top-0 will-change-transform">
        <div className="h-7 w-7 rounded-full bg-gaze/15 flex items-center justify-center">
          <div className="h-3.5 w-3.5 rounded-full bg-gaze shadow-[0_0_14px_rgba(201,95,22,0.45)]" />
        </div>
      </div>

      <div className="absolute bottom-8 inset-x-0 flex flex-col items-center gap-3 pointer-events-none">
        <div className="h-1 w-56 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-gaze transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="font-mono text-[11px] text-fade">esc to cancel</p>
      </div>
    </div>
  );
}
