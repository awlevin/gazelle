# Gazelle

A webcam eye-tracking speed-reading trainer. Your gaze drives an amber mark from one
meaningful word to the next, training the three habits that separate fast readers from
slow ones: wide fixation spans, forward commitment (no regressions), and skipping
function words.

## How it works

- **Gaze tracking** — [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
  runs in-browser (WASM/GPU) at camera frame rate. Per frame we extract iris positions
  relative to the eye corners, the eight `eyeLook*` blendshapes, and head pose from the
  facial transformation matrix (`lib/gaze/features.ts`).
- **Calibration** — smooth pursuit: a dot glides through a serpentine path (with eye-lag
  compensation) collecting hundreds of feature/position pairs, then a second shorter pass
  is done while gently swaying the head, so the regression learns to separate eye movement
  from head movement. A ridge regression maps features to screen coordinates
  (`lib/gaze/ridge.ts`), smoothed by a One-Euro filter (`lib/gaze/oneEuro.ts`).
- **Drift correction** — an online offset absorbs post-calibration head drift: every
  gaze-triggered advance nudges it gently, and pressing `space` while looking at the
  dotted next word applies a strong correction and jumps the mark there.
- **Free look mode** — no text, just the live gaze estimate with a fading trail; the
  honest mirror for how good your calibration actually is.
- **Reading** — content words become fixation targets (stopwords are skipped, with a cap
  on how far any leap can be — `lib/text.ts`). Because webcam gaze is only accurate to a
  coin-sized blur, the reader detects *arrival near the next target* with generous
  elliptical hit zones and saccade direction, not exact fixation (`components/Reader.tsx`).
- **Pacer mode** — the same drill driven by a timer at a chosen WPM, no camera needed.
- **Review** — live WPM, regression and skip counts, a comprehension quiz per built-in
  passage, and session history in localStorage.

## Run it

```bash
npm install   # postinstall fetches the MediaPipe WASM + face model into public/
npm run dev
```

Open http://localhost:3000, allow camera access, calibrate, read.

Keys while reading: `space` jump to the dotted word + retune tracking (gaze mode) ·
`p` pause · `g` toggle gaze dot · `c` recalibrate · `←/→` manual · `esc` exit.

## Notes on accuracy

Webcam gaze estimation is physically limited to roughly 2–4° of visual angle
(~100–200px at normal viewing distance). Gazelle is designed around that: large type,
tall line spacing, wide landing zones, and a two-frame dwell before advancing. Good,
even lighting on your face and a reasonably still head make a big difference — the
calibration screen reports its own error estimate so you know what you're working with.
