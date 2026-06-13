# 🎭 VERSIONS

**⚛️ Lepton Agents Hackathon 2026 - The Marketplace for Alternate Takes**

**Monetizing the creative process through a human-powered taste graph and Arc L1 nanopayments.**

---

## 🏆 Current Focus: Lepton Hackathon (June 15-29, 2026)

VERSIONS is building a **SubmitHub-style marketplace** for demos, live recordings, and alternate takes. We solve the discovery problem for "rare" music while bootstrapping a creator economy via instant USDC settlement on the **Arc L1**.

**[⚛️ Lepton Strategy & Roadmap](docs/LEPTON_STRATEGY.md)** | **[📺 Watch 3-Minute Demo Video](#)**

### The MVP Mechanic (Phase 1)
- **Active Submission**: Artists pay a USDC fee to have their alternate takes curated.
- **Paid Curation**: Listeners (Curators) earn USDC for providing structured, subjective ratings.
- **Taste Graph**: Curation generates high-signal metadata (solo intensity, energy, mood) that makes the catalog discoverable.

---

## 💡 The Concept

Music is not a static product; it is a process. Artists like John Mayer or The Grateful Dead play the same song differently every night. 

### The Problem
- **Passive Value**: Demos and live takes are "dead" assets because they lack structured metadata and efficient payment rails.
- **The $2.00 Floor**: Traditional payment systems can't handle the micro-rewards required for curators and micro-royalties for artists.

### The Solution
1.  **Human-Powered Taste Graph**: Structured subjective ratings (1-10 on specific dimensions) create a discovery layer that algorithms can't touch.
2.  **Nanopayment Settlement**: Arc L1 allows for instant, sub-cent rewards for curators and artists, settled in native USDC.

---

## ✨ Features (Hackathon MVP)

✅ **Submission Queue** - Artists pay to enter; Curators get paid to rate.  
✅ **Structured Rating Engine** - Mapping solo intensity, energy, and tempo feel.  
✅ **Arc L1 Settlement** - Instant USDC payouts for every curation event.  
✅ **Version Catalog** - "Published" takes become discoverable once curated.  
✅ **Farcaster Social Layer** - Share your best "finds" to the social graph.  

---

## 🏗️ Architecture: The Marketplace Model

```
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│      ARTIST      │          │     VERSIONS     │          │     CURATOR      │
│ (Uploads Version)│          │   MARKETPLACE    │          │ (Rates Version)  │
└────────┬─────────┘          └────────┬─────────┘          └────────┬─────────┘
         │                             │                             │
    (Pays USDC) ──────────────────────►│◄────────────────────── (Earns USDC)
         │                             │                             │
         ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│     Arc L1       │◄────────►│   Taste Graph    │◄────────►│   Catalog        │
│  (Settlement)    │          │   (Metadata)     │          │ (Discovery)      │
└──────────────────┘          └──────────────────┘          └──────────────────┘
```
