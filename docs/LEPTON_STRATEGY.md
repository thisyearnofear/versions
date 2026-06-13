# ⚛️ LEPTON STRATEGY: VERSIONS Marketplace & Sidecar

## 🎯 Vision: The Economic Home for the "Other" Music
VERSIONS is a two-sided marketplace and discovery layer for **alternate takes, live recordings, and demos** — the high-value music that currently has no economic home.

### The Core Insight
Artists play songs differently every night. Fans value specific versions ("the bluesy 2019 Gravity solo"). VERSIONS monetizes this through two interlocking systems:
1.  **Human-Powered Taste Graph**: Curation through structured, subjective metadata.
2.  **Nanopayment Settlement Layer**: Every interaction is a micro-transaction on **Arc L1 (USDC)**.

---

## 🚀 PHASE 1 (HACKATHON MVP): SUBMISSION MARKETPLACE
To bootstrap the catalog, we are starting with an active **SubmitHub-style marketplace** rather than passive streaming.

### The Mechanic
- **Artists**: Upload a version (MP3/FLAC) + metadata. Pay a **Submission Fee (USDC)** to enter the curation queue.
- **Curators**: Claim tracks and complete a **Structured Rating Form**.
- **Payout**: On submission, the fee pool is split: **70% to Curators, 20% to Platform, 10% to MusicBrainz Attribution**.
- **Discovery**: A version is "published" to the catalog after receiving **N=3** ratings.

### Structured Rating Dimensions
Curators don't just give stars; they map the "taste graph":
- **Solo Intensity** (1–10)
- **Vocal Quality** (1–10)
- **Energy vs. Studio** (Lower / Same / Higher)
- **Tempo Feel** (Dragging / Locked / Rushing)
- **Mood Tags** (Bluesy, Raw, Euphoric, etc.)

---

## 🛰️ PHASE 2 (STRETCH GOAL): SUBSONIC SCROBBLE SIDECAR
Once the catalog is bootstrapped, we enable passive per-second payments via a protocol-level shim.

### Architecture
- **Target**: Navidrome (primary), Koel, Funkwhale.
- **Function**: A lightweight process that runs alongside the media server, intercepts scrobbles, and triggers Arc L1 settlements for discovered versions.

---

## 🛠️ Implementation Mandates

### 1. "Marketplace First"
Prioritize the submission/rating flow over the player UI. The hackathon "win" is showing active USDC flow between artists and curators.

### 2. Structured Metadata
The database must support the specific "Taste Graph" dimensions. Metadata is not just an afterthought; it is the product.

### 3. Arc-Native Settlement
All fees and rewards must be handled as discrete Arc L1 transactions with sub-500ms feedback.

---
*This strategy replaces previous "streaming-first" plans to ensure immediate traction and transaction volume during the Lepton Hackathon.*
