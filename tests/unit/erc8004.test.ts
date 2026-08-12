// MODULAR: ERC-8004 agent identity adapter tests.

import { describe, it, expect } from 'vitest';
import { createErc8004Adapter } from '../../src/adapters/erc8004';

describe('erc8004 adapter (mock)', () => {
  it('lists stable agent identities for the three curation agents', () => {
    const adapter = createErc8004Adapter({
      agentWallets: [
        { label: 'production', wallet: '0x' + '1'.repeat(40) },
        { label: 'performance', wallet: '0x' + '2'.repeat(40) },
        { label: 'market', wallet: '0x' + '3'.repeat(40) },
      ],
    });
    expect(adapter.mock).toBe(true);
    const ids = adapter.listIdentities();
    expect(ids).toHaveLength(3);
    expect(ids[0]!.label).toBe('production');
    expect(ids[0]!.agentId).toMatch(/^\d+$/);
    expect(ids[0]!.registered).toBe(true);
    expect(ids[1]!.agentId).not.toBe(ids[0]!.agentId);
  });
});
