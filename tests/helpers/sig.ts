// MODULAR: EVM signature helpers for tests.
// Hardhat deterministic test keys (well-known, safe in tests).

import { privateKeyToAccount } from 'viem/accounts';

export const TEST_KEYS = {
  // Hardhat deterministic accounts #0..#3
  acc0: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  acc1: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  acc2: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  acc3: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};

function deriveAddress(key: string): `0x${string}` {
  return privateKeyToAccount(key as `0x${string}`).address;
}

export const TEST_ADDRESSES = {
  acc0: deriveAddress(TEST_KEYS.acc0),
  acc1: deriveAddress(TEST_KEYS.acc1),
  acc2: deriveAddress(TEST_KEYS.acc2),
  acc3: deriveAddress(TEST_KEYS.acc3),
};

export const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;

export function getAccount(index: 0 | 1 | 2 | 3) {
  const keys = [TEST_KEYS.acc0, TEST_KEYS.acc1, TEST_KEYS.acc2, TEST_KEYS.acc3];
  const addrs = [TEST_ADDRESSES.acc0, TEST_ADDRESSES.acc1, TEST_ADDRESSES.acc2, TEST_ADDRESSES.acc3];
  const account = privateKeyToAccount(keys[index] as `0x${string}`);
  return { account, address: addrs[index] as `0x${string}` };
}

export async function signMessage(index: 0 | 1 | 2 | 3, message: string): Promise<`0x${string}`> {
  const { account } = getAccount(index);
  return account.signMessage({ message });
}
