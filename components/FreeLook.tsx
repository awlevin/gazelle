"use client";

// Free look: no text, no targets — just the tracker's live estimate of where
// you're looking, with a fading trail. The honest mirror for calibration
// quality: if the dot lands where you look, reading will feel effortless.

import { useEffect, useRef, useState } from "react";
import type { GazeEngine } from "@/lib/gaze/engine";

export default function FreeLook({
  engine,
  onExit,
  onRecalibrate,
}: {
  engine: GazeEngine;
  onExit: () => void;
  onRecalibrate: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const [trackingLost, setTrackingLost] = useState(false);
  const lastFaceRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last: { x: number; y: number } | null = null;

    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const offGaze = engine.onGaze((g) => {
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${g.x - 14}px, ${g.y - 14}px, 0)`;
      }
      ctx.strokeStyle = "rgba(201, 95, 22, 0.35)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      if (last && Math.hypot(g.x - last.x, g.y - last.y) < 400) {
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
      }
      last = { x: g.x, y: g.y };
    });

    const offFrame = engine.onFrame((f) => {
      if (f.faceDetected) lastFaceRef.current = f.t;
      setTrackingLost(f.t - lastFaceRef.current > 1000);
    });

    // Fade the trail toward paper
    const fade = () => {
      ctx.fillStyle = "rgba(236, 238, 226, 0.055)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      raf = requestAnimationFrame(fade);
    };
    raf = requestAnimationFrame(fade);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      offGaze();
      offFrame();
    };
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === "c" || e.key === "C") onRecalibrate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, onRecalibrate]);

  return (
    <div className="fixed inset-0 z-50 bg-paper overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <div ref={dotRef} className="absolute left-0 top-0 will-change-transform pointer-events-none">
        <div className="h-7 w-7 rounded-full border-2 border-gaze bg-gaze/15" />
      </div>

      <div className="absolute top-10 inset-x-0 text-center pointer-events-none">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fade">Free look</p>
        <p className="mt-2 font-serif italic text-xl text-ink">
          Look around. The ring is where Gazelle thinks your eyes are.
        </p>
      </div>

      {trackingLost && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-ink px-5 py-2 font-mono text-xs text-paper">
          Can&apos;t see your eyes — face the camera
        </div>
      )}

      <p className="absolute bottom-8 inset-x-0 text-center font-mono text-[11px] text-fade pointer-events-none">
        c recalibrate · esc exit
      </p>
    </div>
  );
}
