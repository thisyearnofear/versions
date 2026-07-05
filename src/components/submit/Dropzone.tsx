"use client";

// MODULAR: drag/drop file picker. Wraps a hidden <input type="file">
// in a styled, drag-friendly zone. The native input is still
// keyboard-accessible; clicking the zone opens the picker. On
// file selection the parent receives the File via `onFile`; the
// dropzone also probes the duration + pre-computes the waveform
// cover (useCoverFromAudio).

import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { generateCoverSvg } from "@/components/cover/useCoverFromAudio";
import { fmtSize, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface DropzoneProps {
  accept?: string;
  maxSizeBytes?: number;
  onFile: (file: File | null, meta: { coverSvg: string | null; duration: number | null }) => void;
  label?: string;
  hint?: string;
  className?: string;
}

export function Dropzone({
  accept = "audio/*",
  maxSizeBytes = 50 * 1024 * 1024,
  onFile,
  label = "Drop an audio file here",
  hint = "or click to browse · mp3, wav, ogg, flac, m4a · up to 50 MB",
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [coverSvg, setCoverSvg] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const reset = useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
    setFileName(null);
    setFileSize(null);
    setDuration(null);
    setCoverSvg(null);
    setCoverLoading(false);
    onFile(null, { coverSvg: null, duration: null });
  }, [onFile]);

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) {
        reset();
        return;
      }
      if (maxSizeBytes && file.size > maxSizeBytes) {
        reset();
        return;
      }
      setFileName(file.name);
      setFileSize(file.size);
      setDuration(null);
      setCoverSvg(null);
      setCoverLoading(true);

      // Probe duration via a detached Audio element.
      const probe = new Audio();
      probe.preload = "metadata";
      const probeUrl = URL.createObjectURL(file);
      probe.src = probeUrl;
      probe.addEventListener("loadedmetadata", () => {
        const d = fmtDuration(probe.duration);
        setDuration(d ? Number(d.split(":")[0]) * 60 + Number(d.split(":")[1]) : null);
        URL.revokeObjectURL(probeUrl);
      });
      probe.addEventListener("error", () => {
        URL.revokeObjectURL(probeUrl);
      });

      // Pre-compute the waveform cover.
      try {
        const svg = await generateCoverSvg(file, { size: 96 });
        setCoverSvg(svg);
        setCoverLoading(false);
        onFile(file, { coverSvg: svg, duration: null });
      } catch {
        setCoverSvg(null);
        setCoverLoading(false);
        onFile(file, { coverSvg: null, duration: null });
      }
    },
    [maxSizeBytes, onFile, reset],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0] ?? null;
      if (!file) return;
      // CLEAN: DataTransfer.files isn't a real FileList; build a
      // DataTransfer + set input.files so the form's submit handler
      // sees the dropped file via the standard input.files API.
      const dt = new DataTransfer();
      dt.items.add(file);
      if (inputRef.current) {
        inputRef.current.files = dt.files;
        handleFile(file);
      }
    },
    [handleFile],
  );

  useEffect(() => {
    return () => {
      dragDepthRef.current = 0;
    };
  }, []);

  return (
    <div className={cn("w-full", className)}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepthRef.current += 1;
          setIsDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "relative cursor-pointer border border-dashed transition-colors",
          "px-6 py-10 md:py-14 text-center",
          isDragging
            ? "border-[var(--color-rust)] border-solid bg-[var(--color-paper-2)]"
            : "border-[var(--color-hair-strong)] bg-[var(--color-paper)]/40 hover:border-[var(--color-ink)]",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="sr-only"
        />

        <AnimatePresence mode="wait" initial={false}>
          {fileName ? (
            <motion.div
              key="file"
              initial={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="flex flex-col items-center gap-4"
            >
              <div className="font-serif text-base font-medium text-[var(--color-ink)]">
                {fileName}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                {fileSize !== null && fmtSize(fileSize)}
                {duration !== null && ` · ${fmtDuration(duration)}`}
                {duration === null && fileSize !== null && " · …"}
              </div>
              {coverLoading && (
                <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-ink-2)]">
                  Building cover…
                </div>
              )}
              {coverSvg && (
                <div
                  className="w-24 h-24 border border-[var(--color-rust)]"
                  dangerouslySetInnerHTML={{ __html: coverSvg }}
                />
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  reset();
                }}
                className="font-mono text-[10px] uppercase tracking-[0.18em] border border-[var(--color-ink)] px-3 py-2 hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition-[transform,colors] duration-150 ease-out active:scale-[0.97]"
              >
                Remove
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.98, filter: 'blur(4px)' }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="flex flex-col items-center gap-2"
            >
              <div className="font-serif text-2xl">{label}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                {hint}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
