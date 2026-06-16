// MODULAR: Phantom wallet. The single place that knows about window.solana.
// CLEAN: returns promises; never throws on missing wallet — surfaces a
//        structured "missing_wallet" error the UI can render.

'use strict';

const SUBMIT_MESSAGE = 'VERSIONS_LEPTON_SUBMIT';
const CLAIM_MESSAGE = 'VERSIONS_LEPTON_CLAIM';
const RATE_MESSAGE = 'VERSIONS_LEPTON_RATE';

function getProvider() {
  // Phantom is the most common Phantom-compatible wallet; Backpack / Glow
  // also expose window.phantom.solana. Fall back to window.solana for the
  // newer standard.
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana || window.solana || null;
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

export async function connect() {
  const provider = getProvider();
  if (!provider) {
    const err = new Error('No Solana wallet found. Install Phantom (https://phantom.app) and reload.');
    err.code = 'missing_wallet';
    throw err;
  }
  const res = await provider.connect();
  return { address: res.publicKey.toString(), provider };
}

export function wallet() {
  const provider = getProvider();
  if (!provider || !provider.publicKey) return null;
  return provider.publicKey.toString();
}

export async function signMessage(message) {
  const provider = getProvider();
  if (!provider) {
    const err = new Error('No Solana wallet found.');
    err.code = 'missing_wallet';
    throw err;
  }
  // CLEAN: Phantom's signMessage returns { signature, signedMessage } when
  // encoded as a utf-8 string. We send the raw bytes.
  const messageBytes = new TextEncoder().encode(message);
  const res = await provider.signMessage(messageBytes, 'utf8');
  return { signature: bytesToBase64(res.signature), address: provider.publicKey.toString() };
}

export async function signAs(message, expectedAddress) {
  // MODULAR: convenience wrapper that ensures the signing wallet matches
  // the address we expect. The server verifies the signature against the
  // claimed wallet; this guards against the user having switched accounts.
  const provider = getProvider();
  if (!provider || !provider.publicKey) {
    const err = new Error('No Solana wallet connected.');
    err.code = 'missing_wallet';
    throw err;
  }
  const addr = provider.publicKey.toString();
  if (addr !== expectedAddress) {
    const err = new Error('Connected wallet does not match the expected address. Reconnect.');
    err.code = 'wallet_mismatch';
    throw err;
  }
  return signMessage(message);
}

export const messages = { SUBMIT_MESSAGE, CLAIM_MESSAGE, RATE_MESSAGE };
export { base58Encode };
