"use client";

// MODULAR: Consent lineage visualization for the authorized-version pilot.
// Renders a timeline showing: consent → lineage → approval → agent scores →
// licenses → settlement waterfall. Designed for the supervisor dashboard
// and the /versions detail page.

import { cn } from "@/lib/utils";
import type {
  ConsentPolicy,
  RoyaltySplit,
  VersionLineage,
  AuthorizationStatus,
  ProgramStatus,
  AgentDetail,
  AudioFeatures,
} from "@/lib/types";

// ── Data shape ────────────────────────────────────────────────

export interface ConsentLineageData {
  programId: string;
  programStatus: ProgramStatus;
  rightsHolderWallet: string;
  consentPolicy: ConsentPolicy;
  splits: RoyaltySplit[];
  authorizationStatus: AuthorizationStatus | null;
  authorizedAt: string | null;
  lineage: VersionLineage | null;
  agentScores: Array<{
    agent: string;
    detail: AgentDetail;
    why_fits: string[];
  }>;
  licenseCount: number;
  totalSettled: number; // USDC
  audioFeatures: AudioFeatures | null;
}

// ── Public component ──────────────────────────────────────────

export function ConsentLineagePanel({ data }: { data: ConsentLineageData }) {
  return (
    <section
      className="mt-6 border border-[var(--color-hair)] rounded-sm bg-[var(--color-paper)] overflow-hidden"
      aria-label="Consent lineage"
    >
      <div className="px-4 py-2.5 border-b border-[var(--color-hair)] bg-[var(--color-paper-2)] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <h3 className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          Consent Lineage
        </h3>
        <StatusBadge status={data.programStatus} />
      </div>

      <div className="divide-y divide-[var(--color-hair)]">
        {/* 1. Consent */}
        <ConsentRow data={data} />

        {/* 2. Lineage */}
        <LineageRow data={data} />

        {/* 3. Approval */}
        <ApprovalRow data={data} />

        {/* 4. Audio features */}
        <AudioFeaturesRow features={data.audioFeatures} />

        {/* 5. Agent scores */}
        <AgentScoresRow scores={data.agentScores} />

        {/* 6. Settlement */}
        <SettlementRow splits={data.splits} settled={data.totalSettled} licenseCount={data.licenseCount} />
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────

function StatusBadge({ status }: { status: ProgramStatus }) {
  const colors = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    revoked: "bg-red-500/10 text-red-400 border-red-500/30",
    completed: "bg-[var(--color-ink)] text-[var(--color-paper)] border-[var(--color-ink)]",
  };
  return (
    <span className={cn(
      "font-mono text-[8px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm border",
      colors[status],
    )}>
      {status}
    </span>
  );
}

function ConsentRow({ data }: { data: ConsentLineageData }) {
  const policy = data.consentPolicy;
  const walletShort = `${data.rightsHolderWallet.slice(0, 6)}…${data.rightsHolderWallet.slice(-4)}`;

  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-1.5">Consent</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-[var(--color-ink-3)] text-[10px]">Rights holder</span>
          <p className="font-mono text-[10px] truncate">{walletShort}</p>
        </div>
        <div>
          <span className="text-[var(--color-ink-3)] text-[10px]">Term</span>
          <p className="font-mono text-[10px]">{policy.term_months} months</p>
        </div>
        <div className="col-span-2">
          <span className="text-[var(--color-ink-3)] text-[10px]">Allowed transformations</span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {policy.allowed_transformations.map((t) => (
              <span key={t} className="bg-[var(--color-paper-2)] px-1.5 py-0.3 font-mono text-[8px] uppercase rounded-sm border border-[var(--color-hair)]">
                {t}
              </span>
            ))}
          </div>
        </div>
        {policy.prohibited.length > 0 && (
          <div className="col-span-2">
            <span className="text-[var(--color-ink-3)] text-[10px]">Prohibited</span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {policy.prohibited.map((p) => (
                <span key={p} className="bg-red-500/5 px-1.5 py-0.3 font-mono text-[8px] uppercase rounded-sm border border-red-500/20 text-red-400">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LineageRow({ data }: { data: ConsentLineageData }) {
  const lineage = data.lineage;
  if (!lineage) return null;

  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-1.5">Lineage</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {lineage.creator_tools.length > 0 && (
          <div className="col-span-2">
            <span className="text-[var(--color-ink-3)] text-[10px]">Creator tools</span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {lineage.creator_tools.map((tool) => (
                <span key={tool} className="bg-[var(--color-rust)]/10 px-1.5 py-0.3 font-mono text-[8px] uppercase rounded-sm text-[var(--color-rust)] border border-[var(--color-rust)]/30">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}
        {lineage.source_version_ids.length > 0 && (
          <div className="col-span-2">
            <span className="text-[var(--color-ink-3)] text-[10px]">Source versions</span>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {lineage.source_version_ids.map((id) => (
                <span key={id} className="bg-[var(--color-paper-2)] px-1.5 py-0.3 font-mono text-[8px] uppercase rounded-sm border border-[var(--color-hair)]">
                  {id.slice(0, 8)}…
                </span>
              ))}
            </div>
          </div>
        )}
        {lineage.notes && (
          <div className="col-span-2">
            <p className="font-serif text-[11px] text-[var(--color-ink-2)] mt-1">{lineage.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalRow({ data }: { data: ConsentLineageData }) {
  const status = data.authorizationStatus;
  if (!status) return null;

  const colors = {
    pending_approval: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    approved: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    rejected: "text-red-400 border-red-500/30 bg-red-500/5",
  };

  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-1.5">Approval</p>
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border",
        colors[status],
      )}>
        <span className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          status === "approved" ? "bg-emerald-400" : status === "rejected" ? "bg-red-400" : "bg-amber-400 animate-pulse",
        )} />
        <span className="font-mono text-[9px] uppercase tracking-[0.1em]">
          {status.replace(/_/g, " ")}
        </span>
        {data.authorizedAt && (
          <span className="font-mono text-[8px] text-[var(--color-ink-3)] ml-1">
            · {new Date(data.authorizedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}

function AudioFeaturesRow({ features }: { features: AudioFeatures | null }) {
  if (!features) return null;

  const parts: string[] = [];
  if (features.tempo) parts.push(`${features.tempo} BPM`);
  if (features.key) parts.push(features.key);
  if (features.energy !== null) parts.push(`E${features.energy.toFixed(1)}`);
  if (features.loudness !== null) parts.push(`${features.loudness} dB`);

  if (parts.length === 0) return null;

  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-1.5">Audio Features</p>
      <div className="flex flex-wrap gap-1.5">
        {parts.map((p) => (
          <span key={p} className="bg-[var(--color-rust)]/5 px-2 py-0.5 font-mono text-[9px] rounded-sm border border-[var(--color-rust)]/20 text-[var(--color-ink-2)]">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentScoresRow({ scores }: { scores: Array<{ agent: string; detail: AgentDetail; why_fits: string[] }> }) {
  if (scores.length === 0) return null;

  const agentColors: Record<string, string> = {
    production: "border-blue-500/30 bg-blue-500/5 text-blue-400",
    performance: "border-purple-500/30 bg-purple-500/5 text-purple-400",
    market: "border-amber-500/30 bg-amber-500/5 text-amber-400",
  };

  return (
    <div className="px-4 py-3">
      <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)] mb-1.5">Agent Scores</p>
      <div className="space-y-1.5">
        {scores.map((s) => {
          const colorClass = agentColors[s.agent.toLowerCase()] || "border-[var(--color-hair)] bg-[var(--color-paper-2)]";
          return (
            <div key={s.agent} className={cn(
              "flex items-center gap-3 p-2 rounded-sm border",
              colorClass,
            )}>
              <div className="w-8 h-8 rounded-sm bg-current/10 grid place-items-center shrink-0">
                <span className="font-mono text-[11px] font-bold">{s.detail.fit_score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] truncate">{s.detail.metric_label || s.agent}</p>
                {s.why_fits.length > 0 && (
                  <p className="font-serif text-[10px] text-[var(--color-ink-2)] truncate mt-0.5">
                    {s.why_fits[0]}
                  </p>
                )}
              </div>
              {s.detail.note && (
                <p className="font-serif text-[9px] text-[var(--color-ink-3)] italic max-w-[120px] truncate" title={s.detail.note}>
                  {s.detail.note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettlementRow({ splits, settled, licenseCount }: { splits: RoyaltySplit[]; settled: number; licenseCount: number }) {
  if (splits.length === 0) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Settlement Waterfall
        </p>
        <p className="font-mono text-[10px] text-[var(--color-ink-2)]">
          {licenseCount} license{licenseCount !== 1 ? 's' : ''} · {settled.toFixed(4)} USDC total
        </p>
      </div>
      <div className="space-y-1">
        {splits.map((split) => {
          const pct = (split.share_bps / 10000) * 100;
          const amount = (split.share_bps / 10000) * settled;
          return (
            <div key={split.wallet} className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-[var(--color-ink-2)] w-[80px] truncate" title={split.label}>
                {split.label}
              </span>
              <div className="flex-1 h-1.5 bg-[var(--color-paper-2)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-rust)]/60 rounded-full"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="font-mono text-[8px] text-[var(--color-ink-3)] w-[50px] text-right">
                {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}