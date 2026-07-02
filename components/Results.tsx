"use client";

// Post-session review: speed, habits (regressions/skips), a comprehension
// check, and history — because speed without comprehension is just scrolling.

import { useMemo, useState } from "react";
import type { SessionStats } from "./Reader";
import type { Passage } from "@/lib/text";
import { loadHistory, setComprehension, type SessionRecord } from "@/lib/sessions";

function speedNote(wpm: number): string {
  if (wpm < 200) return "Below the typical adult pace of ~230 wpm — focus on trusting the leap.";
  if (wpm < 300) return "Around the typical adult pace. Plenty of headroom before the ~500 wpm comprehension ceiling.";
  if (wpm < 450) return "Well above average. You're reading like the highlight is chasing you.";
  if (wpm < 600) return "Near the comprehension ceiling — check the quiz score before celebrating.";
  return "Beyond the researched comprehension ceiling. If the quiz agrees, you're skimming — also a skill.";
}

export default function Results({
  stats,
  passage,
  passageTitle,
  sessionId,
  onAgain,
  onHome,
}: {
  stats: SessionStats;
  passage: Passage | null; // null for custom text (no quiz)
  passageTitle: string;
  sessionId: string;
  onAgain: () => void;
  onHome: () => void;
}) {
  const wpm = Math.round(stats.words / (stats.ms / 60000));
  const [answers, setAnswers] = useState<(number | null)[]>(
    passage ? passage.quiz.map(() => null) : []
  );
  const [checked, setChecked] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>(loadHistory);

  const score = useMemo(() => {
    if (!passage || !checked) return null;
    const correct = passage.quiz.filter((q, i) => answers[i] === q.answer).length;
    return correct / passage.quiz.length;
  }, [answers, checked, passage]);

  const check = () => {
    if (!passage) return;
    const correct = passage.quiz.filter((q, i) => answers[i] === q.answer).length;
    setChecked(true);
    setHistory(setComprehension(sessionId, correct / passage.quiz.length));
  };

  const secs = (stats.ms / 1000).toFixed(1);

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-2xl px-8 py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
          Session complete · {passageTitle}
        </p>

        <div className="mt-8 flex items-baseline gap-4">
          <span className="font-serif italic text-8xl leading-none text-ink">{wpm}</span>
          <span className="font-mono text-sm text-fade">words per minute</span>
        </div>
        <p className="mt-4 text-base leading-relaxed text-ink/80">{speedNote(wpm)}</p>

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 border-y border-ink/10 py-5 font-mono text-sm sm:grid-cols-4">
          {[
            ["time", `${secs}s`],
            ["fixations", String(stats.fixations)],
            ["regressions", String(stats.regressions)],
            ["skips", String(stats.skips)],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] uppercase tracking-[0.15em] text-fade">{k}</dt>
              <dd className="mt-1 text-lg text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        {passage && (
          <section className="mt-10">
            <h2 className="font-serif italic text-2xl text-ink">Did it stick?</h2>
            <p className="mt-1 font-mono text-xs text-fade">
              Three questions on what you just read. No scrolling back.
            </p>
            <div className="mt-6 space-y-7">
              {passage.quiz.map((q, qi) => (
                <fieldset key={qi}>
                  <legend className="text-[17px] leading-snug text-ink">
                    {qi + 1}. {q.question}
                  </legend>
                  <div className="mt-3 space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const chosen = answers[qi] === oi;
                      const correct = checked && oi === q.answer;
                      const wrong = checked && chosen && oi !== q.answer;
                      return (
                        <label
                          key={oi}
                          className={[
                            "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2 font-mono text-[13px] transition-colors",
                            correct
                              ? "border-moss bg-moss/10 text-ink"
                              : wrong
                                ? "border-gaze bg-gaze/10 text-ink"
                                : chosen
                                  ? "border-ink/50 text-ink"
                                  : "border-ink/15 text-ink/80 hover:border-ink/40",
                          ].join(" ")}
                        >
                          <input
                            type="radio"
                            name={`q${qi}`}
                            className="accent-[#3d5233]"
                            disabled={checked}
                            checked={chosen}
                            onChange={() =>
                              setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))
                            }
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            {!checked ? (
              <button
                disabled={answers.some((a) => a === null)}
                onClick={check}
                className="mt-7 rounded-full bg-moss px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Check comprehension
              </button>
            ) : (
              <p className="mt-7 font-serif italic text-2xl text-ink">
                {Math.round((score ?? 0) * passage.quiz.length)} of {passage.quiz.length} correct
                <span className="ml-3 font-mono not-italic text-xs text-fade">
                  {(score ?? 0) === 1
                    ? "full comprehension at this speed — push faster next time"
                    : (score ?? 0) >= 0.5
                      ? "decent retention — hold this speed until it's easy"
                      : "speed outran comprehension — ease off ~15%"}
                </span>
              </p>
            )}
          </section>
        )}

        {history.length > 1 && (
          <section className="mt-12">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">
              Recent sessions
            </h2>
            <table className="mt-3 w-full font-mono text-[13px]">
              <tbody>
                {history
                  .slice(-6)
                  .reverse()
                  .map((h) => (
                    <tr key={h.id} className="border-b border-ink/8 text-ink/85">
                      <td className="py-2 pr-4 text-fade">
                        {new Date(h.t).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="py-2 pr-4">{h.passage}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-ink">{h.wpm} wpm</td>
                      <td className="py-2 text-right text-fade">
                        {h.comprehension === null
                          ? "—"
                          : `${Math.round(h.comprehension * 100)}% comp`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}

        <div className="mt-12 flex gap-3">
          <button
            onClick={onAgain}
            className="rounded-full bg-moss px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-ink"
          >
            Read again
          </button>
          <button
            onClick={onHome}
            className="rounded-full border border-ink/20 px-6 py-2.5 font-mono text-sm text-ink transition-colors hover:border-ink/50"
          >
            Another passage
          </button>
        </div>
      </div>
    </div>
  );
}
