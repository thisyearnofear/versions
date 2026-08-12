// MODULAR: ERC-8183 license-job adapter tests (mock-first path).

import { describe, it, expect } from 'vitest';
import { createErc8183Adapter, licenseDeliverableHash } from '../../src/adapters/erc8183';

describe('erc8183 adapter (mock)', () => {
  it('opens a deterministic job id without RPC', async () => {
    const adapter = createErc8183Adapter({});
    expect(adapter.mock).toBe(true);

    const deliverableHash = licenseDeliverableHash({
      briefHash: 'abc',
      submissionId: 'sub-1',
      usageType: 'sync_tv_film',
      feeUsdc: '250.00',
    });
    expect(deliverableHash.startsWith('0x')).toBe(true);
    expect(deliverableHash.length).toBe(66);

    const opened = await adapter.openLicenseJob({
      clientAddress: '0x' + '1'.repeat(40),
      providerAddress: '0x' + '2'.repeat(40),
      evaluatorAddress: '0x' + '1'.repeat(40),
      description: 'VERSIONS sync license · take=sub-1',
      budgetUsdc: '250.00',
      deliverableHash,
    });
    expect(opened.mock).toBe(true);
    expect(opened.status).toBe('Open');
    expect(opened.jobId).toMatch(/^\d+$/);
    expect(opened.createTxHash.startsWith('0x')).toBe(true);

    const again = await adapter.openLicenseJob({
      clientAddress: '0x' + '1'.repeat(40),
      providerAddress: '0x' + '2'.repeat(40),
      evaluatorAddress: '0x' + '1'.repeat(40),
      description: 'VERSIONS sync license · take=sub-1',
      budgetUsdc: '250.00',
      deliverableHash,
    });
    expect(again.jobId).toBe(opened.jobId);
  });

  it('settles Open → Completed with fund/submit/complete hashes', async () => {
    const adapter = createErc8183Adapter({});
    const deliverableHash = licenseDeliverableHash({
      briefHash: 'brief',
      submissionId: 'sub-2',
      usageType: 'sync_ad',
      feeUsdc: '150.00',
    });
    const settled = await adapter.settleLicenseJob({
      clientAddress: '0x' + 'a'.repeat(40),
      providerAddress: '0x' + 'b'.repeat(40),
      evaluatorAddress: '0x' + 'a'.repeat(40),
      description: 'settle test',
      budgetUsdc: '150.00',
      deliverableHash,
    });
    expect(settled.mock).toBe(true);
    expect(settled.status).toBe('Completed');
    expect(settled.fundTxHash).toBeTruthy();
    expect(settled.submitTxHash).toBeTruthy();
    expect(settled.completeTxHash).toBeTruthy();
    expect(settled.deliverableHash).toBe(deliverableHash);
  });
});
