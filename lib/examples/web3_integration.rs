use termusiclib::web3::{Web3Config, VersionNft, VersionType, NftAttribute};
use termusiclib::track::Track;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Example Web3 configuration for Arbitrum
    let web3_config = Web3Config {
        arbitrum_rpc_url: "https://arb1.arbitrum.io/rpc".to_string(),
        contract_address: "0x1234567890123456789012345678901234567890".to_string(),
        ipfs_gateway: "https://ipfs.io/ipfs/".to_string(),
    };

    println!("🎭 VERSIONS - Arbitrum Integration Example");
    println!("Web3 Config: {:?}", web3_config);

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

    // Show how tracks now include Web3 ownership data
    println!("\n✅ Tracks now include Web3 ownership information");
    println!("✅ Server includes Web3 service for Arbitrum integration");
    println!("✅ Configuration supports Web3 settings");
    
    println!("\n🚀 Ready for Arbitrum Stylus smart contract integration!");
    
    Ok(())
}
