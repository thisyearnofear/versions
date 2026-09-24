"use client";

// P0.1 (docs/interface.md §4.4 rung 2): personal relevance BEFORE identity.
// A guest pastes their channel URL/handle and describes what they publish;
// we compose that into the browse query and rank. Nothing is written, no
// account, no wallet — /channels is where "save & verify" happens.
//
// CLAIM DISCIPLINE: this is a *vibe preview*, not channel-ethos ranking.
// Ethos ranking needs a registered + verified channel (channelId), so the
// copy says what it is and the follow-on CTA is the honest next rung.

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browseHref } from "@/lib/marketplace-client";
import { track } from "@/lib/analytics";

/** Best-effort handle from a YouTube URL / @handle / raw name. */
export function handleFromChannelInput(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const at = s.match(/@([A-Za-z0-9._-]{2,})/);
  if (at) return at[1].replace(/[._-]+/g, " ");
  const custom = s.match(/\/c\/([^/?#]+)/);
  if (custom) return decodeURIComponent(custom[1]).replace(/[-_]+/g, " ");
  const user = s.match(/\/user\/([^/?#]+)/);
  if (user) return decodeURIComponent(user[1]).replace(/[-_]+/g, " ");
  // A bare phrase (no URL) is itself a usable vibe.
  if (!/^https?:\/\//i.test(s) && !/^UC[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return "";
}

export function ChannelProbe() {
  const router = useRouter();
  const [channel, setChannel] = useState("");
  const [vibe, setVibe] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    const handle = handleFromChannelInput(channel);
    const query = [vibe.trim(), handle].filter(Boolean).join(" ").trim();
    if (query.length < 2) {
      setError("Add your channel or describe what it publishes — even one line is enough.");
      return;
    }
    setError(null);
    track("probe_run", { surface: "discover", has_handle: !!handle });
    router.push(browseHref({ q: query }));
  }, [channel, vibe, router]);

  return (
    <form
      id="channel-probe"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="card-surface scroll-mt-24 p-4 sm:p-5"
      aria-label="Preview supply for your channel"
    >
      <p className="kicker kicker--accent">Preview for your channel</p>
      <p className="mt-1 font-serif text-[15px] leading-snug text-[var(--color-ink-2)]">
        Paste your channel and the vibe you publish — we rank the catalog against it. No account,
        nothing saved.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="marketplace-label">Your channel (URL, @handle, or name)</span>
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="https://www.youtube.com/@lofigirl"
            inputMode="url"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="marketplace-label">What does it publish?</span>
          <input
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="lo-fi study, calm, instrumental"
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-hair)] bg-transparent px-3 font-serif text-[15px] focus:outline-none focus:border-[var(--color-rust)]"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary">
          See what fits
        </button>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Ranked from what you told us ·{" "}
          <Link href="/channels" className="underline decoration-[var(--color-hair-strong)] hover:text-[var(--color-rust)]">
            save &amp; verify to rank by its real ethos
          </Link>
        </p>
      </div>
      {error && (
        <p role="alert" className="mt-2 font-serif text-[14px] text-[var(--color-rust)]">
          {error}
        </p>
      )}
    </form>
  );
}
