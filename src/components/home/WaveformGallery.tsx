"use client";

// MODULAR: kinetic waveform gallery for the landing page. Published
// album covers ride along an SVG waveform path — scroll advances
// them across the wave with tangent rotation, giving the first-screen
// the energy of music in motion. Falls back to placeholder covers
// when the catalog is empty (mock mode / fresh deploy).

import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { apiClient, type FeedRow } from "@/lib/api-client";

const WAVE_WIDTH = 1600;
const WAVE_HEIGHT = 280;
const COVER_SIZE = 72;
const MAX_COVERS = 8;

// Sample N evenly-spaced points along the SVG path.
function samplePathPoints(
  pathEl: SVGPathElement,
  count: number,
): Array<{ x: number; y: number; angle: number }> {
  const len = pathEl.getTotalLength();
  const points: Array<{ x: number; y: number; angle: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const p = pathEl.getPointAtLength(t * len);
    // Tangent angle from a nearby point
    const p2 = pathEl.getPointAtLength(Math.min(len, t * len + 1));
    const angle = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
    points.push({ x: p.x, y: p.y, angle });
  }
  return points;
}

// The waveform SVG path — a smooth sine-like wave across the width.
const WAVE_PATH = `M 0 ${WAVE_HEIGHT / 2}
  C ${WAVE_WIDTH * 0.1} ${WAVE_HEIGHT * 0.15}, ${WAVE_WIDTH * 0.2} ${WAVE_HEIGHT * 0.85}, ${WAVE_WIDTH * 0.3} ${WAVE_HEIGHT * 0.5}
  C ${WAVE_WIDTH * 0.4} ${WAVE_HEIGHT * 0.15}, ${WAVE_WIDTH * 0.5} ${WAVE_HEIGHT * 0.85}, ${WAVE_WIDTH * 0.6} ${WAVE_HEIGHT * 0.5}
  C ${WAVE_WIDTH * 0.7} ${WAVE_HEIGHT * 0.15}, ${WAVE_WIDTH * 0.8} ${WAVE_HEIGHT * 0.85}, ${WAVE_WIDTH * 0.9} ${WAVE_HEIGHT * 0.5}
  C ${WAVE_WIDTH * 0.95} ${WAVE_HEIGHT * 0.35}, ${WAVE_WIDTH * 0.98} ${WAVE_HEIGHT * 0.55}, ${WAVE_WIDTH} ${WAVE_HEIGHT * 0.5}`;

interface CoverItem {
  id: string;
  title: string;
  artist: string;
  coverSvg: string | null;
}

export function WaveformGallery() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [covers, setCovers] = useState<CoverItem[]>([]);
  const [points, setPoints] = useState<Array<{ x: number; y: number; angle: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  // Horizontal pan: scroll moves covers across the wave.
  const x = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  // Subtle wave opacity fade in/out.
  const waveOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.3, 0.6, 0.6, 0.3]);

  // Fetch published versions for covers.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .getFeed({ limit: MAX_COVERS })
      .then(({ rows }) => {
        if (cancelled) return;
        const items: CoverItem[] = (rows || [])
          .slice(0, MAX_COVERS)
          .map((r: FeedRow) => ({
            id: r.submission_id,
            title: r.title,
            artist: r.artist_name,
            coverSvg: r.cover_svg ?? null,
          }));
        // Pad with placeholders if fewer than 4.
        while (items.length < 4) {
          items.push({
            id: `placeholder-${items.length}`,
            title: "",
            artist: "",
            coverSvg: null,
          });
        }
        setCovers(items);
      })
      .catch(() => {
        if (cancelled) return;
        setCovers(
          Array.from({ length: 6 }, (_, i) => ({
            id: `placeholder-${i}`,
            title: "",
            artist: "",
            coverSvg: null,
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sample path points once the path is in the DOM.
  useEffect(() => {
    if (!pathRef.current || covers.length === 0) return;
    const pts = samplePathPoints(pathRef.current, covers.length);
    setPoints(pts);
  }, [covers]);

  // Re-sample on resize.
  useEffect(() => {
    function onResize() {
      if (!pathRef.current || covers.length === 0) return;
      setPoints(samplePathPoints(pathRef.current, covers.length));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [covers]);

  return (
    <section
      ref={containerRef}
      className="relative overflow-hidden border-t border-b border-[var(--color-hair-strong)]"
      style={{ height: `${WAVE_HEIGHT + 120}px` }}
    >
      {/* Scrollable wave container */}
      <motion.div
        style={{ x }}
        className="absolute inset-0 flex items-center"
      >
        <svg
          width={WAVE_WIDTH}
          height={WAVE_HEIGHT}
          viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
          className="absolute top-1/2 left-0 -translate-y-1/2"
          preserveAspectRatio="xMidYMid meet"
        >
          <motion.path
            ref={pathRef}
            d={WAVE_PATH}
            fill="none"
            stroke="var(--color-rust)"
            strokeWidth={2}
            style={{ opacity: waveOpacity }}
          />
          {/* Glow line under the wave */}
          <motion.path
            d={WAVE_PATH}
            fill="none"
            stroke="var(--color-rust)"
            strokeWidth={1}
            style={{ opacity: waveOpacity, filter: "blur(8px)" }}
          />
        </svg>

        {/* Covers positioned along the wave */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2" style={{ width: `${WAVE_WIDTH}px` }}>
          {points.length === covers.length &&
            covers.map((cover, i) => {
              const pt = points[i];
              if (!pt) return null;
              const isPlaceholder = cover.id.startsWith("placeholder");
              return (
                <motion.div
                  key={cover.id}
                  className="absolute"
                  style={{
                    left: `${pt.x}px`,
                    top: `${pt.y - COVER_SIZE / 2}px`,
                    width: `${COVER_SIZE}px`,
                    height: `${COVER_SIZE}px`,
                    rotate: `${pt.angle * 0.3}deg`,
                  }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isPlaceholder ? (
                    <div
                      className="w-full h-full border-2 border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] flex items-center justify-center"
                      style={{ borderRadius: "4px" }}
                    >
                      <span className="font-mono text-[8px] text-[var(--color-ink-3)]">···</span>
                    </div>
                  ) : (
                    <div className="w-full h-full relative group cursor-pointer" style={{ borderRadius: "4px", overflow: "hidden" }}>
                      {cover.coverSvg ? (
                        <div
                          className="w-full h-full"
                          dangerouslySetInnerHTML={{ __html: cover.coverSvg }}
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[var(--color-rust)] to-[var(--color-rust-dark)] flex items-center justify-center">
                          <span className="font-serif text-lg text-[var(--color-paper)] font-black">
                            {cover.title.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      {/* Hover tooltip */}
                      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-ink-2)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {cover.title} · {cover.artist}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
        </div>
      </motion.div>

      {/* Section label */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
          {loaded ? "From the catalog" : "Loading…"}
        </p>
      </div>
    </section>
  );
}
