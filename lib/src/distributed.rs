use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// IPFS configuration for decentralized storage
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct IpfsConfig {
    pub gateway_url: String,
    pub api_url: String,
    pub pin_remote: bool,
    pub local_node: bool,
}

impl Default for IpfsConfig {
    fn default() -> Self {
        Self {
            gateway_url: "https://ipfs.io/ipfs/".to_string(),
            api_url: "http://localhost:5001".to_string(),
            pin_remote: true,
            local_node: false,
        }
    }
}

/// P2P network configuration
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct P2pConfig {
    pub enable_discovery: bool,
    pub bootstrap_nodes: Vec<String>,
    pub listen_port: u16,
}

impl Default for P2pConfig {
    fn default() -> Self {
        Self {
            enable_discovery: true,
            bootstrap_nodes: vec![],
            listen_port: 4001,
        }
    }
}

/// Distributed storage metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributedFile {
    pub ipfs_hash: String,
    pub file_size: u64,
    pub mime_type: String,
    pub local_path: Option<PathBuf>,
    pub pinned: bool,
    pub replicas: Vec<String>, // List of nodes that have this file
}

/// Combined distributed configuration
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DistributedConfig {
    pub ipfs: IpfsConfig,
    pub p2p: P2pConfig,
    pub enable_hybrid_storage: bool, // Use both local and distributed
}

impl Default for DistributedConfig {
    fn default() -> Self {
        Self {
            ipfs: IpfsConfig::default(),
            p2p: P2pConfig::default(),
            enable_hybrid_storage: true,
        }
    }
}