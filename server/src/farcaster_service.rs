use anyhow::{Result, anyhow};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;

/// Neynar API response structures (following their API spec)
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct NeynarUser {
    fid: u64,
    username: String,
    display_name: Option<String>,
    bio: Option<String>,
    follower_count: u32,
    following_count: u32,
    pfp_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NeynarCast {
    hash: String,
    author: NeynarUser,
    text: String,
    timestamp: String,
    replies: NeynarCastCounts,
    reactions: NeynarCastCounts,
}

#[derive(Debug, Deserialize)]
struct NeynarCastCounts {
    count: u32,
}

#[derive(Debug, Deserialize)]
struct NeynarUserResponse {
    user: NeynarUser,
}

#[derive(Debug, Deserialize)]
struct NeynarCastsResponse {
    casts: Vec<NeynarCast>,
}

/// MODULAR: Farcaster service following our architecture patterns
#[derive(Debug, Clone)]
pub struct FarcasterService {
    client: reqwest::Client,
    neynar_api_key: Option<String>,
    neynar_base_url: String,
    // PERFORMANT: Cache for user data
    user_cache: HashMap<u64, FarcasterUser>,
}

/// CLEAN: Farcaster user data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FarcasterUser {
    pub fid: u64,
    pub username: String,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub follower_count: u32,
    pub following_count: u32,
}

/// CLEAN: Farcaster cast data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FarcasterCast {
    pub hash: String,
    pub author_fid: u64,
    pub text: String,
    pub timestamp: String,
    pub replies_count: u32,
    pub reactions_count: u32,
}

/// ENHANCEMENT: Social recommendation data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialRecommendation {
    pub version_id: String,
    pub title: String,
    pub artist: String,
    pub version_type: String,
    pub recommended_by_fid: u64,
    pub recommended_by_username: String,
    pub reason: String,
    pub score: f64,
}

impl FarcasterService {
    /// CLEAN: Constructor following our patterns
    pub fn new() -> Self {
        let neynar_api_key = env::var("NEYNAR_API_KEY").ok();
        if neynar_api_key.is_none() {
            warn!("NEYNAR_API_KEY not set - using mock data for Farcaster integration");
        } else {
            info!("NEYNAR_API_KEY found - using real Farcaster API");
        }

        Self {
            client: reqwest::Client::new(),
            neynar_api_key,
            neynar_base_url: "https://api.neynar.com/v2".to_string(),
            user_cache: HashMap::new(),
        }
    }

    /// PERFORMANT: Get user profile with caching
    pub async fn get_user_profile(&mut self, fid: u64) -> Result<FarcasterUser> {
        // Check cache first (PERFORMANT principle)
        if let Some(user) = self.user_cache.get(&fid) {
            return Ok(user.clone());
        }

        let user = if let Some(ref api_key) = self.neynar_api_key {
            // Real API call to Neynar
            match self.fetch_user_from_neynar(fid, api_key).await {
                Ok(user) => user,
                Err(e) => {
                    warn!(
                        "Failed to fetch user {} from Neynar API: {}. Using fallback.",
                        fid, e
                    );
                    self.create_fallback_user(fid)
                }
            }
        } else {
            // Fallback to mock data when no API key
            self.create_fallback_user(fid)
        };

        // Cache the result (PERFORMANT principle)
        self.user_cache.insert(fid, user.clone());
        Ok(user)
    }

    /// MODULAR: Fetch user from Neynar API
    async fn fetch_user_from_neynar(&self, fid: u64, api_key: &str) -> Result<FarcasterUser> {
        let url = format!("{}/farcaster/user?fid={}", self.neynar_base_url, fid);

        let response = self
            .client
            .get(&url)
            .header("api_key", api_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| anyhow!("Failed to make request to Neynar: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!("Neynar API returned status: {}", response.status()));
        }

        let neynar_response: NeynarUserResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse Neynar response: {}", e))?;

        Ok(FarcasterUser {
            fid: neynar_response.user.fid,
            username: neynar_response.user.username,
            display_name: neynar_response.user.display_name,
            bio: neynar_response.user.bio,
            follower_count: neynar_response.user.follower_count,
            following_count: neynar_response.user.following_count,
        })
    }

    /// CLEAN: Create fallback user for when API is unavailable
    fn create_fallback_user(&self, fid: u64) -> FarcasterUser {
        FarcasterUser {
            fid,
            username: format!("user{}", fid),
            display_name: Some(format!("Farcaster User {}", fid)),
            bio: Some("Music lover on Farcaster".to_string()),
            follower_count: 100,
            following_count: 50,
        }
    }

    /// MODULAR: Get social graph for recommendations
    #[allow(dead_code)] // Will be used for social recommendations
    pub async fn get_social_graph(&self, _fid: u64) -> Result<Vec<u64>> {
        // TODO: Implement actual Farcaster API call
        // For now, return mock data
        Ok(vec![1, 2, 3, 4, 5])
    }

    /// CLEAN: Cast a version discovery to Farcaster
    pub async fn cast_version_discovery(&self, text: &str, embed_url: &str) -> Result<String> {
        // TODO: Implement actual Farcaster cast API
        // For now, return mock cast hash
        Ok(format!("0x{:x}", text.len() + embed_url.len()))
    }

    /// MODULAR: Get version discussions from Farcaster
    pub async fn get_version_discussions(&self, version_id: &str) -> Result<Vec<FarcasterCast>> {
        if let Some(ref api_key) = self.neynar_api_key {
            // Real API call to search for casts about this version
            match self.search_casts_for_version(version_id, api_key).await {
                Ok(casts) => Ok(casts),
                Err(e) => {
                    warn!(
                        "Failed to search casts for version {}: {}. Using fallback.",
                        version_id, e
                    );
                    Ok(self.create_fallback_discussions(version_id))
                }
            }
        } else {
            // Fallback to mock data
            Ok(self.create_fallback_discussions(version_id))
        }
    }

    /// MODULAR: Search casts about a version using Neynar API
    async fn search_casts_for_version(
        &self,
        version_id: &str,
        api_key: &str,
    ) -> Result<Vec<FarcasterCast>> {
        // Search for casts mentioning the version
        let search_query = format!("{}+version+music", version_id.replace("-", "+"));
        let url = format!(
            "{}/farcaster/cast/search?q={}&limit=10",
            self.neynar_base_url, search_query
        );

        let response = self
            .client
            .get(&url)
            .header("api_key", api_key)
            .header("accept", "application/json")
            .send()
            .await
            .map_err(|e| anyhow!("Failed to search casts: {}", e))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Neynar search API returned status: {}",
                response.status()
            ));
        }

        let search_response: NeynarCastsResponse = response
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse search response: {}", e))?;

        Ok(search_response
            .casts
            .into_iter()
            .map(|neynar_cast| FarcasterCast {
                hash: neynar_cast.hash,
                author_fid: neynar_cast.author.fid,
                text: neynar_cast.text,
                timestamp: neynar_cast.timestamp,
                replies_count: neynar_cast.replies.count,
                reactions_count: neynar_cast.reactions.count,
            })
            .collect())
    }

    /// CLEAN: Create fallback discussions for when API is unavailable
    fn create_fallback_discussions(&self, version_id: &str) -> Vec<FarcasterCast> {
        vec![
            FarcasterCast {
                hash: "0x123".to_string(),
                author_fid: 1,
                text: format!("Love this version of {}!", version_id),
                timestamp: "2024-01-01T00:00:00Z".to_string(),
                replies_count: 5,
                reactions_count: 20,
            },
            FarcasterCast {
                hash: "0x456".to_string(),
                author_fid: 2,
                text: format!("This {} version hits different! 🔥", version_id),
                timestamp: "2024-01-02T00:00:00Z".to_string(),
                replies_count: 3,
                reactions_count: 15,
            },
        ]
    }

    /// ENHANCEMENT: Get social recommendations based on Farcaster graph
    pub async fn get_social_recommendations(&self, fid: u64) -> Result<Vec<SocialRecommendation>> {
        // TODO: Implement actual social graph analysis
        // For now, return mock recommendations based on user's social graph
        let social_graph = self.get_social_graph(fid).await?;

        // MODULAR: Generate recommendations based on social connections
        let recommendations = vec![
            SocialRecommendation {
                version_id: "bohemian-rhapsody-live-aid".to_string(),
                title: "Bohemian Rhapsody (Live Aid 1985)".to_string(),
                artist: "Queen".to_string(),
                version_type: "Live".to_string(),
                recommended_by_fid: social_graph.first().copied().unwrap_or(1),
                recommended_by_username: "musiclover1".to_string(),
                reason: "Your friend discovered this legendary performance".to_string(),
                score: 0.95,
            },
            SocialRecommendation {
                version_id: "stairway-acoustic".to_string(),
                title: "Stairway to Heaven (Acoustic)".to_string(),
                artist: "Led Zeppelin".to_string(),
                version_type: "Acoustic".to_string(),
                recommended_by_fid: social_graph.get(1).copied().unwrap_or(2),
                recommended_by_username: "rockfan42".to_string(),
                reason: "Popular in your music network".to_string(),
                score: 0.87,
            },
        ];

        Ok(recommendations)
    }
}

impl Default for FarcasterService {
    fn default() -> Self {
        Self::new()
    }
}
