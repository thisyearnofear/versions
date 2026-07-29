// MODULAR: deterministic signer derivation + signer registry for the
// arc adapter. One env var (AGENT_KEY_SEED) gives every agent its own
// testnet wallet that can genuinely sign USDC transfers — no per-agent
// key custody. Without a seed, callers fall back to address-only
// identities and the arc adapter mock-settles transfers from them.
//
// SECURITY: seed-derived keys are for testnet demos only. The seed is
// never committed; anyone holding the seed can recompute every agent
// key, which is exactly the low-ops tradeoff we want pre-mainnet.

import { createHash } from 'crypto';
import { getAddress } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

export type SignerMap = Record<string, `0x${string}`>; // lowercase address → private key

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Derive a deterministic private key + address from a seed + label. */
export function deriveAgentKey(
  seed: string,
  label: string,
): { privateKey: `0x${string}`; address: string } {
  if (!seed) throw new Error('seed is required');
  if (!label) throw new Error('label is required');
  // sha256 output is < secp256k1 order for all practical inputs; viem
  // throws on the astronomically-unlikely invalid scalar, so re-hash
  // with a counter until valid (loop runs once in practice).
  let material = `${seed}:${label}`;
  for (let i = 0; i < 8; i++) {
    const privateKey = `0x${sha256Hex(material)}` as `0x${string}`;
    try {
      const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
      return { privateKey, address: account.address };
    } catch {
      material = `${material}:${i}`;
    }
  }
  throw new Error(`unable to derive a valid key for label ${label}`);
}

/**
 * Deterministic valid EVM address when no seed is configured. Not a
 * spendable wallet (no known key) — a stable ledger identity that
 * survives real-mode address validation.
 */
export function deterministicAddress(label: string): string {
  return getAddress(('0x' + sha256Hex('versions:' + label).slice(0, 40)) as `0x${string}`);
}

export interface BuiltSigners {
  signers: SignerMap;
  /** label → derived address (only for seed-derived agents). */
  addresses: Record<string, string>;
}

/**
 * Build the signer map the arc adapter uses to resolve `from` →
 * private key. Includes the platform key (when set) and one derived
 * key per agent label (when a seed is set).
 */
export function buildSignerMap({
  platformWalletPrivateKey,
  agentKeySeed,
  labels = [],
}: {
  platformWalletPrivateKey?: string;
  agentKeySeed?: string;
  labels?: string[];
}): BuiltSigners {
  const signers: SignerMap = {};
  const addresses: Record<string, string> = {};

  if (platformWalletPrivateKey) {
    const normalized = platformWalletPrivateKey.trim();
    const key = (normalized.startsWith('0x') ? normalized : `0x${normalized}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    signers[account.address.toLowerCase()] = key;
  }

  if (agentKeySeed) {
    for (const label of labels) {
      const { privateKey, address } = deriveAgentKey(agentKeySeed, label);
      signers[address.toLowerCase()] = privateKey;
      addresses[label] = address;
    }
  }

  return { signers, addresses };
}
