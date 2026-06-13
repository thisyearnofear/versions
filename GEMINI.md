# 🎭 VERSIONS: PROJECT GUIDELINES

## 🎯 Strategic Focus (June 2026)
We are currently focusing on the **Lepton Agents Hackathon**. The primary goal is to build a **Submission Marketplace for Alternate Takes** using the **Arc L1** for nanopayments.

## 🏗️ Core Principles
- **MARKETPLACE FIRST**: Focus on the submission/curation cycle (Active Payments) before the streaming player (Passive Payments).
- **TASTE GRAPH**: Metadata must be expressive and subjective (Solo Intensity, Vocal Quality, Energy).
- **ARC NATIVE**: Every rating and submission is a discrete Arc L1 transaction.
- **SIDECARE READY**: Phase 2 will pivot to the Subsonic sidecar model once a catalog is bootstrapped.

## 🛠️ Development Mandates
1. **Submission-Fee Logic**: Implement robust handling for the artist submission fee pool (Split: 70/20/10).
2. **Structured Metadata**: The `Version` model must include the specific Taste Graph dimensions (1-10 scales).
3. **Settlement-Grade Logs**: Every curator rating must trigger a settlement event with sub-500ms feedback.
4. **WASM Readiness**: Ensure the rating form can be embedded as a WASM component for future integration.

## 📚 Reference Docs
- `docs/LEPTON_STRATEGY.md`: The roadmap for the hackathon (REVISED for Marketplace MVP).
- `docs/DEVELOPER_GUIDE.md`: General architecture and build instructions.
