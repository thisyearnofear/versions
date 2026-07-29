// MODULAR: the agent identity kit, shared by every surface that renders
// agent activity (AgentMonitor, SubmitForm, ArtistDashboard, EconomyTicker).
// Previously copy-pasted into three components; keep exactly one copy here.
// Client-safe: no server imports.

export type AgentKey = 'production' | 'performance' | 'market' | 'ar';

export interface AgentIdentity {
  icon: string;
  name: string;
  shortName: string;
  color: string;
}

export const AGENT_IDENTITY: Record<AgentKey, AgentIdentity> = {
  production: {
    icon: '🎛️',
    name: 'Production Agent',
    shortName: 'Production',
    color: 'var(--color-rust)',
  },
  performance: {
    icon: '🎤',
    name: 'Performance Agent',
    shortName: 'Performance',
    color: 'var(--color-ink)',
  },
  market: {
    icon: '📊',
    name: 'Market Agent',
    shortName: 'Market',
    color: 'var(--color-ink-2)',
  },
  ar: {
    icon: '🧭',
    name: 'A&R Agent',
    shortName: 'A&R',
    color: 'var(--color-rust-dark)',
  },
};

const FALLBACK: AgentIdentity = {
  icon: '🤖',
  name: 'Agent',
  shortName: 'Agent',
  color: 'var(--color-ink-2)',
};

/** Look up identity for an agentName coming from the DB/bus; tolerant of unknowns. */
export function agentIdentity(name: string | null | undefined): AgentIdentity {
  if (!name) return FALLBACK;
  return AGENT_IDENTITY[name.toLowerCase() as AgentKey] ?? FALLBACK;
}
