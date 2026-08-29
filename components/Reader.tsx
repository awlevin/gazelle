"use client";

// The reading view. The amber pill sits on the current fixation target; a
// dotted underline marks the next one. In gaze mode, landing your eyes near
// the next target advances the pill; in pacer mode a timer drives it.
//
// Hit zones are deliberately generous ellipses — webcam gaze is a coin-sized
// blur, so we detect "arrived near the next word" rather than exact fixation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GazeEngine, GazePoint } from "@/lib/gaze/engine";
import type { Word } from "@/lib/text";

export type SessionStats = {
  ms: number;
  words: number;
  fixations: number;
  regressions: number;
  skips: number;
};

type Props = {
  engine: GazeEngine | null;
  mode: "gaze" | "pacer";
  words: Word[];
  targets: number[]; // word indices that are fixation targets
  pacerWpm: number;
  title: string;
  /** Calibration RMS error in px — hit zones widen to match tracker quality */
  calibrationRms: number | null;
  onExit: () => void;
  onRecalibrate: () => void;
  onFinish: (stats: SessionStats) => void;
};

const ADVANCE_FRAMES = 2; // consecutive frames near next target to advance
const SKIP_FRAMES = 5; // frames on target-after-next to jump two
const REGRESS_FRAMES = 7; // frames on earlier text to log a regression

export default function Reader({
  engine,
  mode,
  words,
  targets,
  pacerWpm,
  title,
  calibrationRms,
  onExit,
  onRecalibrate,
  onFinish,
}: Props) {
  const [currentTi, setCurrentTi] = useState(0); // index into targets
  const [paused, setPaused] = useState(false);
  const [showDot, setShowDot] = useState(true);
  const [trackingLost, setTrackingLost] = useState(false);
  const [liveWpm, setLiveWpm] = useState(0);
  const [elapsedS, setElapsedS] = useState(0);
  const [regressions, setRegressions] = useState(0);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRef = useRef<HTMLDivElement>(null);

  const currentTiRef = useRef(0);
  const pausedRef = useRef(false);
  const statsRef = useRef({ regressions: 0, skips: 0 });
  const nextFramesRef = useRef(0);
  const skipFramesRef = useRef(0);
  const backFramesRef = useRef(0);
  const lastRegressionRef = useRef(0);
  const startRef = useRef(0);
  const pausedAccumRef = useRef(0);
  const pauseStartRef = useRef(0);
  const finishedRef = useRef(false);
  const lastFaceRef = useRef(0);

  const paragraphs = useMemo(() => {
    const out: Word[][] = [];
    for (const w of words) {
      if (!out[w.paragraph]) out[w.paragraph] = [];
      out[w.paragraph].push(w);
    }
    return out.filter(Boolean);
  }, [words]);

  const elapsedMs = useCallback(() => {
    const pausedTotal =
      pausedAccumRef.current + (pausedRef.current ? performance.now() - pauseStartRef.current : 0);
    return performance.now() - startRef.current - pausedTotal;
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish({
      ms: elapsedMs(),
      words: words.length,
      fixations: targets.length,
      regressions: statsRef.current.regressions,
      skips: statsRef.current.skips,
    });
  }, [elapsedMs, onFinish, targets.length, words.length]);

  const advance = useCallback(
    (by: number) => {
      const next = Math.min(currentTiRef.current + by, targets.length - 1);
      if (next === currentTiRef.current) return;
      currentTiRef.current = next;
      setCurrentTi(next);
      nextFramesRef.current = 0;
      skipFramesRef.current = 0;

      const el = wordRefs.current[targets[next]];
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.62) {
          window.scrollTo({
            top: window.scrollY + r.top - window.innerHeight * 0.35,
            behavior: "smooth",
          });
        }
      }
      if (next === targets.length - 1) setTimeout(finish, 600);
    },
    [targets, finish]
  );

  // Timing
  useEffect(() => {
    startRef.current = performance.now();
    window.scrollTo({ top: 0 });
    const id = setInterval(() => {
      if (finishedRef.current) return;
      const ms = elapsedMs();
      setElapsedS(Math.floor(ms / 1000));
      const wordsRead = targets[currentTiRef.current] + 1;
      if (ms > 3000) setLiveWpm(Math.round(wordsRead / (ms / 60000)));
    }, 500);
    return () => clearInterval(id);
  }, [elapsedMs, targets]);

  // Pill placement (relative to the article container so scrolling is free)
  useEffect(() => {
    const place = () => {
      const el = wordRefs.current[targets[currentTi]];
      const container = containerRef.current;
      if (!el || !container) return;
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      setPill({
        left: r.left - c.left - 7,
        top: r.top - c.top - 4,
        width: r.width + 14,
        height: r.height + 8,
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [currentTi, targets]);

  // Gaze-driven advancing
  useEffect(() => {
    if (mode !== "gaze" || !engine) return;

    // Zones widen with measured tracker error: a ±140px calibration needs
    // bigger landing pads than a ±70px one.
    const slack = Math.max(0, (calibrationRms ?? 100) - 80);
    const zone = (wordIdx: number, rxScale = 1) => {
      const el = wordRefs.current[wordIdx];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        rx: Math.max(r.width * 0.85, 95 + slack * 0.8) * rxScale,
        ry: Math.max(r.height * 1.2, 58 + slack * 0.5),
        // Half-height of the word's own line box. The landing ellipse is
        // taller than the line pitch on purpose, so it cannot also decide
        // *which* line the eyes are on — that needs this tighter band.
        line: r.height * 0.8,
      };
    };
    const inZone = (g: GazePoint, z: NonNullable<ReturnType<typeof zone>>) =>
      ((g.x - z.cx) / z.rx) ** 2 + ((g.y - z.cy) / z.ry) ** 2 <= 1;

    const offGaze = engine.onGaze((g) => {
      if (pausedRef.current || finishedRef.current) return;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${g.x - 10}px, ${g.y - 10}px, 0)`;
      }
      const ti = currentTiRef.current;

      // Advance: gaze near the next target, or clearly past it on its line
      if (ti + 1 < targets.length) {
        const z = zone(targets[ti + 1]);
        if (z) {
          const hit = inZone(g, z);
          // "Read past it": on that word's own line and beyond it. Judged on
          // the line band, not the landing ellipse — the ellipse overlaps the
          // neighbouring lines, so using it made every line wrap skip words.
          const passed = Math.abs(g.y - z.cy) < z.line && g.x > z.cx;
          if (hit || passed) {
            if (++nextFramesRef.current >= ADVANCE_FRAMES) {
              // A landing is a weak ground-truth signal: the eyes are (about)
              // on this word. Gently absorb the residual as drift correction.
              if (hit) engine.nudge(z.cx - g.x, z.cy - g.y, 0.08, 40);
              advance(1);
            }
          } else {
            nextFramesRef.current = 0;
          }
        }
      }
      // Skip: gaze committed to the target after next
      if (ti + 2 < targets.length) {
        const z = zone(targets[ti + 2], 0.8);
        if (z && inZone(g, z)) {
          if (++skipFramesRef.current >= SKIP_FRAMES) {
            statsRef.current.skips++;
            advance(2);
          }
        } else {
          skipFramesRef.current = 0;
        }
      }
      // Regression: gaze dwelling on already-read targets
      let onBack = false;
      for (let j = Math.max(0, ti - 6); j <= ti - 2; j++) {
        const z = zone(targets[j], 0.7);
        if (z && inZone(g, z)) {
          onBack = true;
          break;
        }
      }
      if (onBack) {
        if (
          ++backFramesRef.current >= REGRESS_FRAMES &&
          g.t - lastRegressionRef.current > 1500
        ) {
          statsRef.current.regressions++;
          setRegressions(statsRef.current.regressions);
          lastRegressionRef.current = g.t;
          backFramesRef.current = 0;
        }
      } else {
        backFramesRef.current = 0;
      }
    });

    const offFrame = engine.onFrame((f) => {
      if (f.faceDetected) lastFaceRef.current = f.t;
      setTrackingLost(f.t - lastFaceRef.current > 1000);
    });

    return () => {
      offGaze();
      offFrame();
    };
  }, [engine, mode, targets, advance, calibrationRms]);

  // Pacer-driven advancing. Time-based rather than a setTimeout chain, so
  // words-per-minute stays exact even when the browser throttles timers.
  useEffect(() => {
    if (mode !== "pacer") return;
    const msPerWord = 60000 / pacerWpm;
    const id = setInterval(() => {
      if (pausedRef.current || finishedRef.current) return;
      const due = targets[0] + elapsedMs() / msPerWord;
      while (
        currentTiRef.current + 1 < targets.length &&
        targets[currentTiRef.current + 1] <= due
      ) {
        advance(1);
      }
    }, 80);
    return () => clearInterval(id);
  }, [mode, pacerWpm, targets, advance, elapsedMs]);

  // Keys
  useEffect(() => {
    const togglePause = () => {
      setPaused((p) => {
        const np = !p;
        pausedRef.current = np;
        if (np) pauseStartRef.current = performance.now();
        else pausedAccumRef.current += performance.now() - pauseStartRef.current;
        return np;
      });
    };
    // Space = "my eyes are on the dotted word": jump the mark there, and use
    // the moment as strong ground truth to retune the drift correction.
    const syncJump = () => {
      const ti = currentTiRef.current;
      if (engine && ti + 1 < targets.length) {
        const el = wordRefs.current[targets[ti + 1]];
        const g = engine.latestGaze;
        if (el && g && performance.now() - g.t < 400) {
          const r = el.getBoundingClientRect();
          engine.nudge(r.left + r.width / 2 - g.x, r.top + r.height / 2 - g.y, 0.6, 250);
        }
      }
      advance(1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === " ") {
        e.preventDefault();
        if (mode === "gaze") syncJump();
        else togglePause();
      } else if (e.key === "p" || e.key === "P") togglePause();
      else if (e.key === "g" || e.key === "G") setShowDot((d) => !d);
      else if ((e.key === "c" || e.key === "C") && mode === "gaze") onRecalibrate();
      else if (e.key === "ArrowRight") advance(1);
      else if (e.key === "ArrowLeft") {
        const prev = Math.max(0, currentTiRef.current - 1);
        currentTiRef.current = prev;
        setCurrentTi(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, mode, engine, targets, onExit, onRecalibrate]);

  const currentWordIdx = targets[currentTi];
  const nextWordIdx = currentTi + 1 < targets.length ? targets[currentTi + 1] : -1;
  const mm = String(Math.floor(elapsedS / 60)).padStart(2, "0");
  const ss = String(elapsedS % 60).padStart(2, "0");

  return (
    <div className="min-h-screen bg-paper">
      {/* HUD */}
      <header className="fixed top-0 inset-x-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-2.5 font-mono text-[11px] uppercase tracking-[0.15em] text-fade">
          <div className="flex items-center gap-3">
            <span className="text-ink font-medium normal-case tracking-normal font-serif italic text-sm">
              Gazelle
            </span>
            <span className="hidden sm:inline">· {title}</span>
          </div>
          <div className="flex items-center gap-5">
            <span>
              <span className="text-ink text-sm font-semibold">{liveWpm || "—"}</span> wpm
            </span>
            <span>{mm}:{ss}</span>
            <span>regressions {regressions}</span>
            {mode === "gaze" && (
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  trackingLost ? "bg-gaze" : "bg-moss"
                }`}
                title={trackingLost ? "Tracking lost" : "Tracking"}
              />
            )}
            <button onClick={onExit} className="hover:text-ink transition-colors uppercase">
              exit
            </button>
          </div>
        </div>
      </header>

      {/* Text */}
      <main className="mx-auto max-w-[46rem] px-8 pt-32 pb-[55vh]">
        <div ref={containerRef} className="relative">
          {pill && (
            <div
              className="reading-pill absolute rounded-lg bg-gaze/20 ring-1 ring-gaze/30 pointer-events-none"
              style={pill}
            />
          )}
          {paragraphs.map((para, pi) => (
            <p
              key={pi}
              className="relative mb-10 font-serif text-[27px] leading-[2.15] text-ink"
            >
              {para.map((w) => {
                const read = w.index < currentWordIdx;
                const isNext = w.index === nextWordIdx;
                const isCurrent = w.index === currentWordIdx;
                return (
                  <span key={w.index}>
                    <span
                      ref={(el) => {
                        wordRefs.current[w.index] = el;
                      }}
                      // Marks the two live fixation targets in the DOM. Read by
                      // the demo gaze source (lib/gaze/demo.ts) to aim its
                      // synthetic scanpath; harmless otherwise.
                      data-gaze-target={isCurrent ? "current" : isNext ? "next" : undefined}
                      className={[
                        "relative transition-colors duration-150",
                        read && !isCurrent ? "text-fade/70" : "text-ink",
                        isNext
                          ? "underline decoration-dotted decoration-gaze decoration-2 underline-offset-6"
                          : "",
                      ].join(" ")}
                    >
                      {w.text}
                    </span>{" "}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      </main>

      {/* Gaze dot */}
      {mode === "gaze" && showDot && (
        <div
          ref={dotRef}
          className="gaze-dot pointer-events-none fixed left-0 top-0 z-30 h-5 w-5 rounded-full border-2 border-gaze bg-gaze/10"
        />
      )}

      {/* Overlays */}
      {paused && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/80 backdrop-blur-sm">
          <div className="text-center">
            <p className="font-serif italic text-4xl text-ink">Paused</p>
            <p className="mt-3 font-mono text-xs text-fade">p to resume</p>
          </div>
        </div>
      )}
      {trackingLost && !paused && mode === "gaze" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-full bg-ink px-5 py-2 font-mono text-xs text-paper">
          Can&apos;t see your eyes — face the camera
        </div>
      )}

      <footer className="fixed bottom-3 right-5 z-30 font-mono text-[10px] text-fade/80">
        {mode === "gaze"
          ? "space jump to dotted word (retunes tracking) · p pause · g gaze dot · c recalibrate · ←→ manual · esc exit"
          : "space/p pause · g gaze dot · ←→ manual · esc exit"}
      </footer>
    </div>
  );
}
