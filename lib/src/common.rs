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

/// Settlement event representing a unit of value consumed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementEvent {
    pub track_id: String,
    pub artist_id: String,
    pub duration_seconds: u64,
    pub amount_usdc: f64,
    pub timestamp: u64,
    pub wallet_address: String,
}

/// Generic trait for payment providers (e.g., Arc L1, Solana)
#[async_trait]
pub trait SettlementProvider: Send + Sync {
    fn name(&self) -> &str;
    /// Pay royalties for a specific consumption event
    async fn settle_royalty(&self, event: SettlementEvent) -> Result<String>;
    /// Check if a user has unlocked a premium version
    async fn verify_access(&self, track_id: &str, wallet_address: &str) -> Result<bool>;
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
