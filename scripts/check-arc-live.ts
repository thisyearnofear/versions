// MODULAR: Arc go-live readiness check. Prints the exact mock/live
// state the health endpoint reports, plus the settlement-relevant
// details (chain id, USDC contract, platform balance, signer
// config) so an operator can switch the demo loop from mock to real
// Arc testnet money in one glance.
//
// NETWORK: currently Arc TESTNET. Arc MAINNET launches 2026-09-16; until
// then validate against the testnet RPC/contract (see .env.example).
//
// Run:   npm run check:arc
//        ARC_RPC_URL=... ARC_USDC_CONTRACT=... PLATFORM_WALLET=... npm run check:arc
//
// Exit code 0 = live mode configured + reachable; 1 = mock or
// degraded (so it can gate a demo checklist step).

import { services } from '../src/lib/services';

async function main() {
  const c = services().config;
  const arc = services().arc;

  console.log('── VERSIONS Arc readiness ──────────────────────────────\n');

  const arcInfo = await arc.getInfo();

  console.log(`  arc.mock:             ${c.arcMock}`);
  console.log(`  llm.mock:             ${c.llmMock}`);
  console.log(`  embedding.mock:       ${c.embeddingMock}`);
  console.log(`  ipfs.configured:      ${c.ipfsConfigured}`);
  console.log('');
  console.log(`  chainId:              ${arcInfo.chainId ?? '(none)'}`);
  console.log(`  rpcUrl:               ${arcInfo.rpcUrl ?? '(none)'}`);
  console.log(`  usdcContract:         ${arcInfo.usdcContract ?? '(none)'}`);
  console.log(`  platformWallet:       ${c.platformWallet ?? '(none)'}`);
  console.log(
    `  platformUsdcBalance:  ${arcInfo.platformUsdcBalance != null ? `${Number(arcInfo.platformUsdcBalance) / 1e6} USDC` : '(unknown)'}`,
  );
  console.log(`  agentWallets:         ${c.agentWallets.length} (${c.agentWallets.slice(0, 2).join(', ')}${c.agentWallets.length > 2 ? ', …' : ''})`);
  console.log(`  arWallet:             ${c.arWallet}`);

  // Signer configured = PLATFORM_WALLET_PRIVATE_KEY or AGENT_KEY_SEED
  // present, so server-side sends can actually broadcast (mirrors the
  // health endpoint's PLATFORM_WALLET_PRIVATE_KEY check, plus the agent
  // seed). Without a key, sends fall back to deterministic mock hashes.
  const signerConfigured =
    !!process.env.PLATFORM_WALLET_PRIVATE_KEY || !!process.env.AGENT_KEY_SEED;
  console.log('');
  console.log(`  signerConfigured:     ${signerConfigured ? 'yes' : 'no (sends fall back to deterministic mock hashes)'}`);

  const live = !c.arcMock && arcInfo.chainId != null;
  console.log('');
  if (live) {
    console.log('  ✓ LIVE MODE — settlements will broadcast real USDC transfers.');
    console.log('    Verify the platform wallet is funded on the RPC chain before the demo.');
  } else {
    console.log('  ⚠ MOCK MODE — settlements produce deterministic mock hashes.');
    console.log('    Set ARC_RPC_URL + ARC_USDC_CONTRACT + PLATFORM_WALLET (+ keys) to go live.');
  }
  console.log('──────────────────────────────────────────────────────────');
  process.exit(live ? 0 : 1);
}

main().catch((err) => {
  console.error('check:arc failed:', err);
  process.exit(1);
});
