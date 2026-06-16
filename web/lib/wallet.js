// MODULAR: Phantom + EVM wallet. Single entry point for any chain.
// DRY: every wallet interaction in the app goes through this module.
// CLEAN: returns promises; never throws on missing wallet — surfaces a
//        structured error the UI can render with a clear next step.

'use strict';

const SUBMIT_MESSAGE = 'VERSIONS_LEPTON_SUBMIT';
const CLAIM_MESSAGE = 'VERSIONS_LEPTON_CLAIM';
const RATE_MESSAGE = 'VERSIONS_LEPTON_RATE';

function getSolanaProvider() {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana || window.solana || null;
}

function getEvmProvider() {
  // MODULAR: Phantom in EVM mode and MetaMask both inject window.ethereum.
  // We don't reach for window.phantom.ethereum — it isn't a standard
  // shape and confuses the mock fallback path.
  if (typeof window === 'undefined') return null;
  return window.ethereum || null;
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base58Encode(bytes) {
  // MODULAR: minimal base58 encoder. Avoids pulling bs58 into the bundle.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bn = Array.from(bytes);
  let zeros = 0;
  while (zeros < bn.length && bn[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bn.length; i++) {
    let carry = bn[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join('');
}

function to32ByteHex(value) {
  // MODULAR: pad a hex string (no 0x prefix) to 32 bytes (64 hex chars).
  const hex = BigInt(value).toString(16);
  return hex.padStart(64, '0');
}

// MODULAR: encode the ERC-20 transfer(address,uint256) call. Function
// selector is keccak256("transfer(address,uint256)").slice(0,4) =
// 0xa9059cbb. No library needed — the encoding is one selector + two
// 32-byte words.
function encodeErc20Transfer({ to, amountSmallestUnit }) {
  if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) {
    throw new Error('recipient must be a 0x-prefixed 40-char address');
  }
  if (!Number.isFinite(amountSmallestUnit) || amountSmallestUnit < 0) {
    throw new Error('amountSmallestUnit must be a non-negative number');
  }
  const cleanTo = to.slice(2).toLowerCase().padStart(64, '0');
  const cleanAmount = to32ByteHex(amountSmallestUnit);
  return '0xa9059cbb' + cleanTo + cleanAmount;
}

export async function connect() {
  // MODULAR: try Solana first (matches the current Phantom-on-Solana UX),
  // then fall back to EVM. The user picks the chain at connect time.
  const sol = getSolanaProvider();
  if (sol) {
    const res = await sol.connect();
    return { address: res.publicKey.toString(), chain: 'solana', provider: sol };
  }
  const evm = getEvmProvider();
  if (evm) {
    const accounts = await evm.request({ method: 'eth_requestAccounts' });
    return { address: accounts[0], chain: 'evm', provider: evm };
  }
  const err = new Error('No wallet found. Install Phantom (https://phantom.app) or MetaMask and reload.');
  err.code = 'missing_wallet';
  throw err;
}

export function wallet() {
  const sol = getSolanaProvider();
  if (sol && sol.publicKey) return { address: sol.publicKey.toString(), chain: 'solana' };
  // MODULAR: window.ethereum is async (accounts aren't sync-readable), so
  // we can't return the address from this helper. The app stores the
  // address after connect().
  return null;
}

export async function signMessage(message) {
  const sol = getSolanaProvider();
  if (sol) {
    const messageBytes = new TextEncoder().encode(message);
    const res = await sol.signMessage(messageBytes, 'utf8');
    return { signature: bytesToBase64(res.signature), address: sol.publicKey.toString(), chain: 'solana' };
  }
  const err = new Error('Solana wallet not connected. Connect Phantom (Solana) to sign messages.');
  err.code = 'solana_required';
  throw err;
}

export async function signAs(message, expectedAddress) {
  // MODULAR: convenience wrapper that ensures the signing wallet matches
  // the address we expect. The server verifies the signature against the
  // claimed wallet; this guards against the user having switched accounts.
  const sol = getSolanaProvider();
  if (!sol || !sol.publicKey) {
    const err = new Error('No Solana wallet connected.');
    err.code = 'solana_required';
    throw err;
  }
  const addr = sol.publicKey.toString();
  if (addr !== expectedAddress) {
    const err = new Error('Connected wallet does not match the expected address. Reconnect.');
    err.code = 'wallet_mismatch';
    throw err;
  }
  return signMessage(message);
}

// MODULAR: send a real USDC transfer on Arc via window.ethereum. Returns
// the tx hash. The proxy's verify-payment then checks that the tx hit the
// platform wallet with the right amount via the configured ARC_RPC_URL.
export async function sendUsdcTransferViaEvm({ usdcContract, recipient, amountUsdc, decimals = 6 }) {
  const evm = getEvmProvider();
  if (!evm) {
    const err = new Error('No EVM wallet found. Install MetaMask (or Phantom in EVM mode) and reload.');
    err.code = 'missing_evm_wallet';
    throw err;
  }
  if (!usdcContract || !/^0x[0-9a-fA-F]{40}$/.test(usdcContract)) {
    throw new Error('usdcContract must be a 0x-prefixed 40-char address');
  }
  if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new Error('recipient must be a 0x-prefixed 40-char address');
  }
  const accounts = await evm.request({ method: 'eth_requestAccounts' });
  const from = accounts[0];
  // MODULAR: USDC is 6 decimals on most chains. Convert 0.50 → 500000.
  const factor = BigInt(10) ** BigInt(decimals);
  const amountSmallestUnit = (BigInt(Math.round(Number(amountUsdc) * 1e6)) * factor) / 1_000_000n;
  const data = encodeErc20Transfer({ to: recipient, amountSmallestUnit });
  const txHash = await evm.request({
    method: 'eth_sendTransaction',
    params: [{
      from,
      to: usdcContract,
      data,
      value: '0x0',
      gas: '0x186a0'   // 100k — plenty for an ERC-20 transfer
    }]
  });
  return { txHash, from };
}

// MODULAR: also expose the bare EVM provider for cases where the app
// needs to know whether window.ethereum is present (e.g., to show a
// "connect MetaMask" CTA instead of "install MetaMask").
export function hasEvmProvider() {
  return !!getEvmProvider();
}

export const messages = { SUBMIT_MESSAGE, CLAIM_MESSAGE, RATE_MESSAGE };
export { base58Encode, encodeErc20Transfer };
