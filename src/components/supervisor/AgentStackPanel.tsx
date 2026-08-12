"use client";

// MODULAR: Agent Stack surface — ERC-8004 identities + wallets that
// agents use for USDC settlement. Ties the curation agents to the
// Circle agentic economy checklist (wallets, identity, onchain payees).

import { useEffect, useState } from "react";
import { apiClient, type AgentIdentityRow } from "@/lib/api-client";
import { Section } from "@/components/ui/primitives";
import { addressUrl, shortAddress } from "@/lib/explorer";

export function AgentStackPanel() {
  const [agents, setAgents] = useState<AgentIdentityRow[]>([]);
  const [registry, setRegistry] = useState<string | null>(null);
  const [mock, setMock] = useState(true);

  useEffect(() => {
    void apiClient
      .getAgentIdentities()
      .then((res) => {
        setAgents(res.agents);
        setRegistry(res.registry);
        setMock(res.mock);
      })
      .catch(() => {});
  }, []);

  return (
    <Section
      eyebrow="Agent Stack · ERC-8004"
      title="Agent wallets"
      intro="Production, Performance, and Market hold Arc wallets and receive USDC (x402 score fees, settlement legs). Identity IDs map to the ERC-8004 registry on Arc testnet."
      className="py-8"
    >
      <ul className="space-y-2">
        {agents.length === 0 ? (
          <li className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
            Loading agent identities…
          </li>
        ) : (
          agents.map((a) => (
            <li
              key={a.label}
              className="border border-[var(--color-hair)] rounded-sm p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="font-serif text-[14px] font-medium">{a.name}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)] mt-0.5">
                  ERC-8004 #{a.agentId}
                  {mock ? " · demo id" : ""}
                </p>
              </div>
              <a
                href={addressUrl(a.wallet)}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 font-mono text-[11px] text-[var(--color-ink-2)] hover:text-[var(--color-rust)]"
              >
                {shortAddress(a.wallet)} ↗
              </a>
            </li>
          ))
        )}
      </ul>
      {registry && (
        <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
          Registry{" "}
          <a
            href={addressUrl(registry)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-rust)]"
          >
            {shortAddress(registry)}
          </a>
          {" · "}
          <a
            href="https://github.com/circlefin/agent-stack-starter-kits"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-rust)]"
          >
            Agent Stack kits ↗
          </a>
        </p>
      )}
    </Section>
  );
}
