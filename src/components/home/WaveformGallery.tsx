"use client";

// MODULAR: kinetic waveform gallery for the landing page. Published
// album covers ride along an SVG waveform path — scroll advances
// them across the wave with tangent rotation. Clicking the wave plays
// a note (pitch maps to Y position) — the landing page is an instrument.
// Falls back to placeholder covers when the catalog is empty.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { apiClient, type FeedRow } from "@/lib/api-client";
import { playNoteAt, resumeAudio } from "@/lib/audio-feedback";
import { generateRatingCover } from "@/lib/cover-gen";
import { parseMoodTags } from "@/lib/format";

const WAVE_WIDTH = 1600;
const WAVE_HEIGHT = 280;
const MAX_COVERS = 8;

// Responsive cover size: smaller on mobile.
function useCoverSize() {
  const [size, setSize] = useState(72);
  useEffect(() => {
    const update = () => setSize(window.innerWidth < 640 ? 48 : 72);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

function samplePathPoints(
  pathEl: SVGPathElement,
  count: number,
): Array<{ x: number; y: number; angle: number }> {
  const len = pathEl.getTotalLength();
  const points: Array<{ x: number; y: number; angle: number }> = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const p = pathEl.getPointAtLength(t * len);
    const p2 = pathEl.getPointAtLength(Math.min(len, t * len + 1));
    const angle = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
    points.push({ x: p.x, y: p.y, angle });
  }
  return points;
}

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
  energy?: string | null;
  tempo?: string | null;
  avgSolo?: number | null;
  avgVocal?: number | null;
  moodTags?: string[] | null;
}

export function WaveformGallery() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [covers, setCovers] = useState<CoverItem[]>([]);
  const [points, setPoints] = useState<Array<{ x: number; y: number; angle: number }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const coverSize = useCoverSize();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const x = useTransform(scrollYProgress, [0, 1], ["0%", "-40%"]);
  const waveOpacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.3, 0.6, 0.6, 0.3]);

  // Click-to-play: Y position → note pitch. Also spawns a ripple.
  const handleWaveClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const yRel = (e.clientY - rect.top) / rect.height;
    resumeAudio();
    playNoteAt(Math.max(0, Math.min(1, yRel)));
    // Ripple at click point (in SVG coordinates).
    const xRel = ((e.clientX - rect.left) / rect.width) * WAVE_WIDTH;
    const ySvg = yRel * WAVE_HEIGHT;
    const id = Date.now();
    setRipples((prev) => [...prev, { id, x: xRel, y: ySvg }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600);
  }, []);

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
            energy: r.energy_consensus,
            tempo: r.tempo_consensus,
            avgSolo: r.avg_solo_intensity,
            avgVocal: r.avg_vocal_quality,
            moodTags: parseMoodTags(r.aggregated_mood_tags),
          }));
        while (items.length < 4) {
          items.push({ id: `placeholder-${items.length}`, title: "", artist: "", coverSvg: null });
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

  useEffect(() => {
    if (!pathRef.current || covers.length === 0) return;
    setPoints(samplePathPoints(pathRef.current, covers.length));
  }, [covers]);

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
      className="relative overflow-hidden border-t border-b border-[var(--color-hair-strong)] h-[320px] sm:h-[400px]"
    >
      <motion.div style={{ x }} className="absolute inset-0 flex items-center">
        <svg
          width={WAVE_WIDTH}
          height={WAVE_HEIGHT}
          viewBox={`0 0 ${WAVE_WIDTH} ${WAVE_HEIGHT}`}
          className="absolute top-1/2 left-0 -translate-y-1/2 cursor-pointer touch-pan-y"
          preserveAspectRatio="xMidYMid meet"
          onClick={handleWaveClick}
        >
          <motion.path
            ref={pathRef}
            d={WAVE_PATH}
            fill="none"
            stroke="var(--color-rust)"
            strokeWidth={2}
            style={{ opacity: waveOpacity }}
          />
          <motion.path
            d={WAVE_PATH}
            fill="none"
            stroke="var(--color-rust)"
            strokeWidth={1}
            style={{ opacity: waveOpacity, filter: "blur(8px)" }}
          />
          {/* Click ripples */}
          {ripples.map((r) => (
            <motion.circle
              key={r.id}
              cx={r.x}
              cy={r.y}
              r={0}
              fill="var(--color-rust)"
              initial={{ r: 0, opacity: 0.4 }}
              animate={{ r: 30, opacity: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          ))}
        </svg>

        <div
          className="absolute top-1/2 left-0 -translate-y-1/2"
          style={{ width: `${WAVE_WIDTH}px`, height: `${WAVE_HEIGHT}px` }}
        >
          {points.length === covers.length &&
            covers.map((cover, i) => {
              const pt = points[i];
              if (!pt) return null;
              const isPlaceholder = !cover.id || cover.id.startsWith("placeholder");
              return (
                <motion.div
                  key={cover.id}
                  className="absolute"
                  style={{
                    left: `${pt.x}px`,
                    top: `${pt.y - coverSize / 2}px`,
                    width: `${coverSize}px`,
                    height: `${coverSize}px`,
                    rotate: `${pt.angle * 0.3}deg`,
                  }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isPlaceholder ? (
                    <div
                      className="w-full h-full border-2 border-[var(--color-hair-strong)] bg-[var(--color-paper-2)] flex items-center justify-center rounded"
                    >
                      <span className="font-mono text-[8px] text-[var(--color-ink-3)]">···</span>
                    </div>
                  ) : (
                    <div className="w-full h-full relative group cursor-pointer rounded overflow-hidden">
                      {cover.coverSvg ? (
                        <div className="w-full h-full" dangerouslySetInnerHTML={{ __html: cover.coverSvg }} />
                      ) : (
                        <div
                          className="w-full h-full"
                          dangerouslySetInnerHTML={{
                            // MODULAR: deterministic rating-driven fallback so
                            // the hero shows unique art even for legacy rows
                            // with null cover_svg.
                            __html: generateRatingCover({
                              title: cover.title || cover.id,
                              avgSolo: cover.avgSolo,
                              avgVocal: cover.avgVocal,
                              energy: cover.energy,
                              tempo: cover.tempo,
                              moodTags: cover.moodTags ?? [],
                            }),
                          }}
                        />
                      )}
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

      {/* Section label + play hint */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center pointer-events-none">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-ink-3)]">
          {loaded ? "From the catalog · click to play" : "Loading…"}
        </p>
      </div>
    </section>
  );
}
