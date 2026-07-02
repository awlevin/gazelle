"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GazeEngine } from "@/lib/gaze/engine";
import { PASSAGES, tokenize, selectTargets, wordCount, type Passage } from "@/lib/text";
import { saveSession } from "@/lib/sessions";
import Calibration from "@/components/Calibration";
import Reader, { type SessionStats } from "@/components/Reader";
import Results from "@/components/Results";
import FreeLook from "@/components/FreeLook";

type Stage = "home" | "loading" | "calibrate" | "read" | "results" | "freelook";
type Mode = "gaze" | "pacer";

const SPANS = [
  { value: 2, label: "Tight", hint: "leap every ~2 words" },
  { value: 3, label: "Standard", hint: "leap every ~3 words" },
  { value: 4, label: "Wide", hint: "leap every ~4 words" },
];

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [mode, setMode] = useState<Mode>("gaze");
  const [span, setSpan] = useState(3);
  const [pacerWpm, setPacerWpm] = useState(350);
  const [passageId, setPassageId] = useState(PASSAGES[0].id);
  const [customText, setCustomText] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [engine, setEngine] = useState<GazeEngine | null>(null);
  const [calibRms, setCalibRms] = useState<number | null>(null);
  const [afterCalibrate, setAfterCalibrate] = useState<"read" | "freelook">("read");
  const [calibPreview, setCalibPreview] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);

  const passage: Passage | null = useCustom
    ? null
    : (PASSAGES.find((p) => p.id === passageId) ?? PASSAGES[0]);

  const activeParagraphs = useMemo(() => {
    if (passage) return passage.paragraphs;
    return customText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [passage, customText]);

  const words = useMemo(() => tokenize(activeParagraphs), [activeParagraphs]);
  const targets = useMemo(() => selectTargets(words, span), [words, span]);
  const title = passage ? passage.title : "Your text";

  useEffect(() => () => engine?.dispose(), [engine]);

  const start = useCallback(async (dest: "read" | "freelook") => {
    setError(null);
    if (dest === "read" && words.length < 20) {
      setError("That text is too short to train on — paste at least a few sentences.");
      return;
    }
    if (dest === "read" && mode === "pacer") {
      setStage("read");
      return;
    }
    setAfterCalibrate(dest);
    setStage("loading");
    try {
      let active = engine;
      if (!active) {
        active = new GazeEngine();
        await active.init(videoRef.current!);
        setEngine(active);
      }
      setStage(active.model.fitted ? dest : "calibrate");
    } catch (e) {
      console.error(e);
      if (!engine && videoRef.current) {
        // Partially-initialized engine may hold the camera stream
        const stream = videoRef.current.srcObject as MediaStream | null;
        stream?.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
      setEngine(null);
      setError(
        "Couldn't start the camera. Check the browser's camera permission, or switch to the pacer — it trains the same leap without a webcam."
      );
      setStage("home");
    }
  }, [engine, mode, words.length]);

  const cameraVisible = stage === "calibrate" && calibPreview;

  return (
    <div className="min-h-screen bg-paper">
      {/* Persistent camera element — visible only during calibration */}
      <video
        ref={videoRef}
        muted
        playsInline
        className={
          cameraVisible
            ? "fixed bottom-5 right-5 z-[60] h-28 w-auto rounded-lg border border-ink/20 shadow-sm -scale-x-100"
            : "fixed h-px w-px opacity-0 pointer-events-none"
        }
      />

      {stage === "home" && (
        <main className="mx-auto max-w-2xl px-8 pb-24">
          {/* Hero */}
          <section className="pt-20">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fade">
              Eye-trained reading
            </p>
            <div className="relative mt-4">
              <div className="scanpath-dot absolute -top-1 h-4 w-4" aria-hidden>
                <span className="block h-4 w-4 rounded-full bg-gaze" />
              </div>
              <h1 className="font-serif italic font-light text-[clamp(4rem,14vw,7.5rem)] leading-none tracking-tight text-ink">
                Gazelle
              </h1>
            </div>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-ink/85">
              Your eyes don&apos;t glide across a page — they leap. Gazelle watches where you
              look and moves the mark one meaningful word ahead, so you practice landing
              only where meaning lives.
            </p>
          </section>

          {/* Method */}
          <section className="mt-14 grid gap-6 border-y border-ink/10 py-8 sm:grid-cols-3">
            {[
              ["Calibrate", "Follow a gliding dot — head still, then swaying gently — so Gazelle learns your eyes and your head separately."],
              ["Read by leaping", "An amber mark sits on the current word; a dotted line shows the next landing site. Your gaze does the turning."],
              ["Review honestly", "Speed, regressions, and a short quiz — because fast without comprehension is just scrolling."],
            ].map(([h, body]) => (
              <div key={h}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-moss">{h}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{body}</p>
              </div>
            ))}
          </section>

          <p className="mt-6 font-mono text-xs leading-relaxed text-fade">
            A webcam sees your gaze as a coin-sized blur, not a laser dot. Gazelle sizes its
            targets accordingly — big type, wide landing zones, forgiving jumps.
          </p>

          {/* Passage picker */}
          <section className="mt-12">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
              Choose a passage
            </h2>
            <div className="mt-4 space-y-2">
              {PASSAGES.map((p) => {
                const active = !useCustom && passageId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPassageId(p.id);
                      setUseCustom(false);
                    }}
                    className={[
                      "flex w-full items-baseline justify-between rounded-xl border px-5 py-3.5 text-left transition-colors",
                      active
                        ? "border-moss bg-moss/8 ring-1 ring-moss"
                        : "border-ink/15 hover:border-ink/40",
                    ].join(" ")}
                  >
                    <span className="font-serif text-lg text-ink">{p.title}</span>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-fade">
                      {p.difficulty} · {wordCount(p)} words · quiz
                    </span>
                  </button>
                );
              })}
              <div
                className={[
                  "rounded-xl border px-5 py-3.5 transition-colors",
                  useCustom ? "border-moss bg-moss/8 ring-1 ring-moss" : "border-ink/15",
                ].join(" ")}
              >
                <button onClick={() => setUseCustom(true)} className="w-full text-left">
                  <span className="font-serif text-lg text-ink">Your own text</span>
                  <span className="ml-3 font-mono text-[11px] uppercase tracking-wider text-fade">
                    paste anything · no quiz
                  </span>
                </button>
                {useCustom && (
                  <textarea
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="Paste a few paragraphs…"
                    rows={5}
                    className="mt-3 w-full rounded-lg border border-ink/15 bg-paper-deep/50 p-3 font-serif text-[15px] leading-relaxed text-ink outline-none focus:border-moss"
                  />
                )}
              </div>
            </div>
          </section>

          {/* Settings */}
          <section className="mt-10 grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">Drive</h2>
              <div className="mt-3 flex rounded-full border border-ink/15 p-1 font-mono text-[13px]">
                {(
                  [
                    ["gaze", "Webcam gaze"],
                    ["pacer", "Auto pacer"],
                  ] as [Mode, string][]
                ).map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={[
                      "flex-1 rounded-full px-4 py-2 transition-colors",
                      mode === m ? "bg-moss text-paper" : "text-ink/70 hover:text-ink",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-fade">
                {mode === "gaze"
                  ? "Your eyes advance the mark. Needs a webcam and 30s of calibration."
                  : "A timer advances the mark at a fixed pace. No camera needed."}
              </p>
              {mode === "pacer" && (
                <div className="mt-4">
                  <label className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.15em] text-fade">
                    Pace
                    <span className="text-ink text-sm normal-case tracking-normal">
                      {pacerWpm} wpm
                    </span>
                  </label>
                  <input
                    type="range"
                    min={200}
                    max={700}
                    step={25}
                    value={pacerWpm}
                    onChange={(e) => setPacerWpm(Number(e.target.value))}
                    className="mt-2 w-full accent-[#3d5233]"
                  />
                </div>
              )}
            </div>
            <div>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
                Fixation span
              </h2>
              <div className="mt-3 flex rounded-full border border-ink/15 p-1 font-mono text-[13px]">
                {SPANS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setSpan(s.value)}
                    className={[
                      "flex-1 rounded-full px-4 py-2 transition-colors",
                      span === s.value ? "bg-moss text-paper" : "text-ink/70 hover:text-ink",
                    ].join(" ")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-fade">
                {SPANS.find((s) => s.value === span)?.hint} — widen as skipping starts to feel
                safe.
              </p>
            </div>
          </section>

          {error && (
            <p className="mt-8 rounded-lg border border-gaze/40 bg-gaze/10 px-4 py-3 font-mono text-xs leading-relaxed text-ink">
              {error}
            </p>
          )}

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <button
              onClick={() => start("read")}
              className="w-full whitespace-nowrap rounded-full bg-moss px-10 py-4 font-mono text-sm uppercase tracking-[0.2em] text-paper transition-colors hover:bg-ink sm:w-auto sm:px-14"
            >
              {mode === "gaze" ? "Calibrate & read" : "Start reading"}
            </button>
            <button
              onClick={() => start("freelook")}
              className="font-mono text-xs text-fade underline decoration-dotted underline-offset-4 transition-colors hover:text-ink"
            >
              or free look — watch where Gazelle thinks your eyes are
            </button>
          </div>
        </main>
      )}

      {stage === "loading" && (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div className="scanpath-dot relative mx-auto h-4 w-40">
              <span className="absolute block h-4 w-4 rounded-full bg-gaze" />
            </div>
            <p className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-fade">
              Starting camera &amp; loading the eye model…
            </p>
          </div>
        </div>
      )}

      {stage === "calibrate" && engine && (
        <Calibration
          engine={engine}
          onDone={(rms) => {
            setCalibRms(rms);
            setStage(afterCalibrate);
          }}
          onCancel={() => setStage("home")}
          onPreviewChange={setCalibPreview}
        />
      )}

      {stage === "freelook" && engine && (
        <FreeLook
          engine={engine}
          onExit={() => setStage("home")}
          onRecalibrate={() => {
            setAfterCalibrate("freelook");
            setStage("calibrate");
          }}
        />
      )}

      {stage === "read" && (
        <Reader
          key={`${title}-${span}-${mode}`}
          engine={engine}
          mode={mode}
          words={words}
          targets={targets}
          pacerWpm={pacerWpm}
          title={title}
          calibrationRms={calibRms}
          onExit={() => setStage("home")}
          onRecalibrate={() => {
            setAfterCalibrate("read");
            setStage("calibrate");
          }}
          onFinish={(s) => {
            setStats(s);
            setSessionId(
              saveSession({
                t: Date.now(),
                passage: title,
                wpm: Math.round(s.words / (s.ms / 60000)),
                comprehension: null,
                regressions: s.regressions,
              })
            );
            setStage("results");
          }}
        />
      )}

      {stage === "results" && stats && (
        <Results
          stats={stats}
          passage={passage}
          passageTitle={title}
          sessionId={sessionId}
          onAgain={() => setStage("read")}
          onHome={() => setStage("home")}
        />
      )}
    </div>
  );
}
