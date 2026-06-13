/// Constant strings for Unknown values
pub mod const_unknown {
    use crate::const_str;

    const_str! {
        UNKNOWN_ARTIST "Unknown Artist",
        UNKNOWN_TITLE "Unknown Title",
        UNKNOWN_ALBUM "Unknown Album",
        UNKNOWN_FILE "Unknown File",
    }
}

use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Type of settlement interaction
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SettlementType {
    SubmissionFee,   // Artist pays to enter queue
    CuratorReward,   // Curator earns for rating
    PlatformFee,    // VERSIONS treasury split
    AttributionFee, // MusicBrainz/Original Artist split
    StreamingRoyalty, // Phase 2: Per-second payment
}

/// Settlement event representing a unit of value moved on Arc L1
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementEvent {
    pub event_type: SettlementType,
    pub track_id: String,
    pub amount_usdc: f64,
    pub from_wallet: String,
    pub to_wallet: String,
    pub timestamp: u64,
    pub metadata: Option<String>, // Optional JSON for MBID or Rating ID
}

/// Subjective rating dimensions for the Human-Powered Taste Graph
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TasteRating {
    pub solo_intensity: u8, // 1-10
    pub vocal_quality: u8,  // 1-10
    pub energy_level: String, // "lower", "same", "higher"
    pub tempo_feel: String,   // "dragging", "locked", "rushing"
    pub mood_tags: Vec<String>,
    pub curator_note: Option<String>,
}

/// Generic trait for payment providers (e.g., Arc L1, Solana)
#[async_trait]
pub trait SettlementProvider: Send + Sync {
    fn name(&self) -> &str;
    /// Execute a settlement on-chain
    async fn settle(&self, event: SettlementEvent) -> Result<String>;
    /// Verify if a version has met the curation threshold (N=3)
    async fn verify_publication_status(&self, track_id: &str) -> Result<bool>;
}

/// Metadata for stored content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentMetadata {
    pub cid: String,
    pub size: u64,
    pub mime_type: String,
    pub provider: String,
}

/// Generic trait for decentralized storage providers (e.g., Filecoin, IPFS)
#[async_trait]
pub trait StorageProvider: Send + Sync {
    fn name(&self) -> &str;
    /// Upload content to decentralized storage
    async fn upload(&self, data: Vec<u8>, file_id: &str) -> Result<ContentMetadata>;
    /// Retrieve content stream URL from storage
    async fn get_stream_url(&self, cid: &str) -> Result<String>;
}
