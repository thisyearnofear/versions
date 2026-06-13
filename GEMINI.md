# 🎭 VERSIONS: PROJECT GUIDELINES

## 🎯 Strategic Focus (June 2026)
We are currently focusing on the **Lepton Agents Hackathon**. The primary goal is to implement **Nanopayments for the Creator Economy** using the **Arc L1** and the **Subsonic Sidecar** model.

## 🏗️ Core Principles
- **SIDECARE FIRST**: Build components that can be plugged into existing media stacks (Subsonic, Audius, Navidrome).
- **NANOPAYMENTS**: Every 30 seconds of playback counts. Optimize for high-frequency, low-value transactions.
- **ARC NATIVE**: Prefer Arc L1 for settlement and USDC for value.
- **ENHANCEMENT FIRST**: Improve the existing `termusic` Rust foundation before adding new wrappers.

## 🛠️ Development Mandates
1. **No Bloat**: Audit every dependency. If it's not needed for settlement, streaming, or metadata, don't add it.
2. **Explicit Composition**: Use traits (like `SettlementProvider`) to keep payment logic decoupled from audio playback.
3. **Settlement-Grade Logs**: Ensure every `TrackChanged` or `Progress` event is logged with enough metadata (MBID, Duration) for later settlement.
4. **WASM Readiness**: Keep `lib/src` compatible with `wasm32-unknown-unknown` for future browser-side settlement.

## 📚 Reference Docs
- `docs/LEPTON_STRATEGY.md`: The roadmap for the hackathon.
- `docs/DEVELOPER_GUIDE.md`: General architecture and build instructions.
