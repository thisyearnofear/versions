# ⚛️ LEPTON STRATEGY: VERSIONS as a Settlement Sidecar

## 🎯 Vision
Transform **VERSIONS** from a standalone player into a **Micro-Settlement Sidecar** for the creator economy. Using the **Arc L1** and **USDC**, we will enable per-second royalties for music demos and rare versions that were previously uneconomic to monetize.

## 🏗️ Architectural Pivot: The Sidecar Model
Instead of requiring users to switch to a new app, VERSIONS will act as a "shim" or "sidecar" that attaches to existing open-source media stacks.

### 1. Subsonic Scrobble Sidecar (RFB #1)
- **Protocol**: Implement the Subsonic API.
- **Hook**: When a Subsonic client (DSub, Play:Sub, etc.) sends a "scrobble" or "now playing" event, VERSIONS intercepts it.
- **Action**: The interception triggers a settlement event on the Arc L1.

### 2. Arc L1 Settlement Layer
- **Currency**: USDC (native on Arc).
- **Frequency**: Every 30 seconds of playback or per-track "unlock."
- **Efficiency**: Leveraging Arc's <500ms finality to provide instant feedback to the creator.

### 3. Metadata & Payee Mapping (RFB #2)
- **Registry**: Use MusicBrainz IDs (MBID) as the primary key.
- **Mapping**: Create a lightweight registry mapping `MBID -> Wallet Address`.
- **Fallthrough**: If no mapping exists, use a decentralized attribution model (e.g., Audius artist metadata).

## 🛠️ Foundation Components (Phase 1: June 15-17)

### A. The `Settlement` Trait (Rust)
Define a generic trait in `lib/src/common.rs` that abstracts the payment provider:
```rust
pub trait SettlementProvider {
    fn name(&self) -> &str;
    async fn pay_royalty(&self, amount_usdc: f64, payee: &str) -> Result<String>;
    async fn verify_unlock(&self, track_id: &str, user_wallet: &str) -> Result<bool>;
}
```

### B. The Subsonic Adapter
Create a new module `server/src/subsonic_adapter.rs` to handle:
- Ping/Auth
- `getMusicDirectory` (Proxy to local/Audius)
- `scrobble` (The hook for payments)

## 📅 Roadmap for Hackathon (June 15-29)
1. **Foundation (June 15)**: Implement `Settlement` trait and Arc L1 boilerplate.
2. **Sidecar (June 17)**: Launch Subsonic shim that proxies Audius tracks.
3. **Mini App (June 20)**: Farcaster Mini App for "One-Click Settlement" discovery.
4. **Validation (June 25)**: End-to-end demo: "Play in DSub, Get Paid in Arc Wallet."

---
*This document serves as the foundational mandate for the Lepton 2026 Hackathon development.*
