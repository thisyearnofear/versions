use serde::{Deserialize, Serialize};

/// Version NFT metadata following ERC-721 standard
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionNft {
    pub token_id: u64,
    pub name: String,
    pub description: String,
    pub image: String,
    pub attributes: Vec<NftAttribute>,
    pub version_type: VersionType,
    pub audio_hash: String, // IPFS hash
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftAttribute {
    pub trait_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VersionType {
    Demo,
    Remix,
    Live,
    Alternative,
    Remaster,
}

/// Minimal Web3 configuration
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Web3Config {
    pub arbitrum_rpc_url: String,
    pub contract_address: String,
    pub ipfs_gateway: String,
}

impl Default for Web3Config {
    fn default() -> Self {
        Self {
            arbitrum_rpc_url: "https://arb1.arbitrum.io/rpc".to_string(),
            contract_address: String::new(),
            ipfs_gateway: "https://ipfs.io/ipfs/".to_string(),
        }
    }
}

/// Version ownership and metadata
#[derive(Debug, Clone)]
pub struct VersionOwnership {
    pub nft_data: Option<VersionNft>,
    pub owner_address: Option<String>,
    pub is_verified: bool,
}

impl Default for VersionOwnership {
    fn default() -> Self {
        Self {
            nft_data: None,
            owner_address: None,
            is_verified: false,
        }
    }
}
