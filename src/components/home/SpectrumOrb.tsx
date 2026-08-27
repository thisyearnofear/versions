"use client";

// MODULAR: the hero's beating heart — a radial audio spectrum drawn on
// canvas. It rotates, the bars breathe (deterministic pseudo-spectrum),
// and the cursor acts as an energy source: bars near the pointer's
// angle swell, giving the visitor a tactile, musical surface to play
// with the moment the page loads. No audio file required (ambient
// representation of the catalog's sound). Fully still under
// reduced-motion (renders a static glow ring).

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

const BARS = 72;
const ROT_SPEED = 0.0016; // radians / frame

function pseudoSpectrum(i: number, t: number): number {
  // Layered sines → organic, non-repeating-but-deterministic bar heights.
  const a = Math.sin(i * 0.31 + t * 0.0021);
  const b = Math.sin(i * 0.13 - t * 0.0014);
  const c = Math.sin(i * 0.07 + t * 0.0009);
  return 0.42 + 0.34 * a + 0.18 * b + 0.1 * c; // ~0..1
}

export function SpectrumOrb({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ active: boolean; angle: number; dist: number }>({
    active: false,
    angle: 0,
    dist: 0,
  });

  useEffect(() => {
    if (reduce) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let rot = 0;
    let t = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      pointer.current.active = true;
      pointer.current.angle = Math.atan2(dy, dx);
      pointer.current.dist = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    };
    const onLeave = () => {
      pointer.current.active = false;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    const RUST = "#c84a1f";
    const EMBER = "#e8762a";
    const INK = "rgba(26,26,26,";

    const draw = () => {
      t += 1;
      rot += ROT_SPEED;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) * 0.26;
      const maxBar = Math.min(w, h) * 0.18;

      // Glow halo behind the orb.
      const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius + maxBar);
      halo.addColorStop(0, "rgba(200,74,31,0.16)");
      halo.addColorStop(1, "rgba(200,74,31,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // Inner ring.
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `${INK}0.10)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      const pa = pointer.current.angle;
      const pActive = pointer.current.active;

      for (let i = 0; i < BARS; i++) {
        const ang = rot + (i / BARS) * Math.PI * 2;
        let amp = pseudoSpectrum(i, t);

        // Pointer energy: bars near the cursor's angle swell.
        if (pActive) {
          const diff = Math.abs(((ang - pa + Math.PI) % (Math.PI * 2)) - Math.PI);
          const prox = 1 - diff / (Math.PI * 0.5); // 1 at cursor, 0 at 90° away
          if (prox > 0) amp += prox * prox * 0.5 * (0.4 + pointer.current.dist);
        }
        amp = Math.min(1, amp);

        const len = radius + amp * maxBar;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const x1 = cx + cosA * radius;
        const y1 = cy + sinA * radius;
        const x2 = cx + cosA * len;
        const y2 = cy + sinA * len;

        // Gradient stroke ember → rust for tall bars.
        const grad = ctx.createLinearGradient(x1, y1, x2, y2);
        grad.addColorStop(0, `${INK}${0.25 + amp * 0.4})`);
        grad.addColorStop(1, amp > 0.7 ? EMBER : RUST);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2 + amp * 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Center pulse.
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (0.18 + pulse * 0.05), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200,74,31,0.10)";
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [reduce]);

  // Reduced-motion: a static glow ring. (A <span> inside <canvas> is
  // fallback content browsers ignore once canvas is supported, so the
  // still render must be a real element, not canvas children.)
  if (reduce) {
    return (
      <div
        aria-hidden="true"
        className={className}
        style={{
          borderRadius: "9999px",
          background:
            "radial-gradient(circle, rgba(200,74,31,0.14) 0%, rgba(200,74,31,0.05) 55%, transparent 72%)",
          border: "1px solid rgba(26,26,26,0.10)",
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ touchAction: "none" }}
    />
  );
}
