"use client";

// ChannelProbePanel — the guest-first front door for /channels.
// Same split as src/components/discovery/ChannelProbe.tsx (paste URL +
// describe the vibe → browse ranked to it), but tuned to the channel
// operator's mental model: "I run X, what fits X?"
// No auth, no write, no wallet. Save & verify is the honest next rung.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browseHref } from "@/lib/marketplace-client";
import { handleFromChannelInput } from "@/components/discovery/ChannelProbe";
import { track } from "@/lib/analytics";

export function ChannelProbePanel() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [vibe, setVibe] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    const handle = handleFromChannelInput(url);
    const query = [vibe.trim(), handle || url.trim()].filter(Boolean).join(" ").trim();
    if (query.length < 2) {
      setError("Paste your channel or describe what it publishes — even one line is enough.");
      return;
    }
    setError(null);
    track("probe_run", { surface: "channels", has_handle: !!handle });
    router.push(browseHref({ q: query }));
  }, [url, vibe, router]);

  return (
    <form
      id="channel-probe"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="card-surface scroll-mt-24 p-5 sm:p-6"
      aria-label="Preview supply for your channel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="kicker kicker--accent">Try before you connect</p>
        <p className="font-mono text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
          No account · no wallet · nothing saved
        </p>
      </div>
      <h3 className="mt-2 font-serif text-xl font-black tracking-tight">Paste your channel. See what fits.</h3>
      <p className="mt-1 max-w-xl font-serif text-[14px] leading-snug text-[var(--color-ink-2)]">
        We rank the catalog against what you publish — tracks and product placements side by side. Save & verify
        when you want that ranking to follow your real reach.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <label className="grid gap-1">
          <span className="marketplace-label">Your channel (URL, @handle, or name)</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/@yourchannel"
            inputMode="url"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 font-serif text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-rust)] focus:outline-none"
          />
        </label>
        <label className="grid gap-1">
          <span className="marketplace-label">What it publishes</span>
          <input
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="lo-fi study, calm, instrumental"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-white px-3 font-serif text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-rust)] focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary">
          See what fits this channel
        </button>
        <span className="font-mono text-[11px] text-[var(--color-ink-3)]">
          Ranked from what you told us ·{" "}
          <Link href="/discover" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
            browse the full catalog
          </Link>
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-3 font-serif text-[14px] text-[var(--color-rust)]">
          {error}
        </p>
      )}

      <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-paper-2)] px-3 py-2.5">
        <p className="font-mono text-[11px] leading-snug text-[var(--color-ink-3)]">
          <strong className="font-semibold text-[var(--color-ink-2)]">What unlocking gets you:</strong> platform-verified subscriber & view counts, paid placements (flat or CPM),{" "}
          <strong className="font-semibold text-[var(--color-ink-2)]">you keep 30%</strong> on every paid use (60/30/10 supplier/channel/platform on Arc), delivery log that survives reload.
        </p>
      </div>
    </form>
  );
}
