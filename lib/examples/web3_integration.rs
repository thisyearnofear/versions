use termusiclib::onchain::{OnchainConfig, VersionNft, VersionType, NftAttribute};
use termusiclib::track::Track;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Example blockchain configuration for Arbitrum
    let onchain_config = OnchainConfig {
        arbitrum_rpc_url: "https://arb1.arbitrum.io/rpc".to_string(),
        contract_address: "0x1234567890123456789012345678901234567890".to_string(),
        ipfs_gateway: "https://ipfs.io/ipfs/".to_string(),
    };

    println!("🎭 VERSIONS - Arbitrum Integration Example");
    println!("Onchain Config: {:?}", onchain_config);

    // Example version NFT metadata
    let version_nft = VersionNft {
        token_id: 1,
        name: "Bohemian Rhapsody - Demo Version".to_string(),
        description: "Early demo recording of Queen's masterpiece".to_string(),
        image: "QmExampleImageHash".to_string(),
        attributes: vec![
            NftAttribute {
                trait_type: "Version Type".to_string(),
                value: "Demo".to_string(),
            },
            NftAttribute {
                trait_type: "Artist".to_string(),
                value: "Queen".to_string(),
            },
            NftAttribute {
                trait_type: "Year".to_string(),
                value: "1975".to_string(),
            },
        ],
        version_type: VersionType::Demo,
        audio_hash: "QmExampleAudioHash".to_string(),
    };

    println!("Example Version NFT: {:?}", version_nft);

    // Show how tracks now include blockchain ownership data
    println!("\n✅ Tracks now include blockchain ownership information");
    println!("✅ Server includes onchain service for Arbitrum integration");
    println!("✅ Configuration supports blockchain settings");
    
    println!("\n🚀 Ready for Arbitrum Stylus smart contract integration!");
    
    Ok(())
}
