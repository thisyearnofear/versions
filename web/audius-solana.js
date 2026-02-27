// AUDIUS + SOLANA INTEGRATION FOR HACKATHON
// "Versions of a song as tickets" - Song versions tied to Audius Artist Coins
//
// PRINCIPLES APPLIED:
// - MODULAR: Pluggable integration, can be removed entirely
// - DRY: Reuses existing API patterns from farcaster-miniapp.js
// - CLEAN: Single responsibility - only wallet/coin logic
// - PERFORMANT: Lazy-loads Audius data, caches wallet state
// - PREVENT BLOAT: Separate file prevents main app bloat

// API Configuration
const API_PROXY = window.location.hostname === 'localhost' 
  ? 'http://localhost:8080'
  : 'https://versions.thisyearnofear.com';

// Helper to call backend proxy
async function proxyFetch(endpoint) {
    const response = await fetch(`${API_PROXY}${endpoint}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

// Make globally available
window.AudiusSolanaIntegration = {
    wallet: null,
    connected: false,
    audiusUser: null,
    ownedCoins: [],
    _cachedTracks: null,
    _cachedArtistCoins: {}, // Cache artist coin lookups

    // Initialize Audius SDK (read-only mode)
    // PERFORMANT: Caches results to avoid repeated calls
    async initAudius() {
        // Return cached if available
        if (this._cachedTracks) {
            return this._cachedTracks;
        }

        console.log('🎵 Loading tracks from Audius...');
        
        try {
            const data = await proxyFetch('/api/v1/audius/trending');
            this._cachedTracks = data.data || [];
            console.log('✅ Audius trending tracks loaded:', this._cachedTracks.length);
            return this._cachedTracks;
        } catch (error) {
            console.error('❌ Audius init failed:', error);
            return [];
        }
    },

    // Fetch track from Audius by ID
    async getTrack(trackId) {
        try {
            const url = getAudiusUrl(`/v1/tracks/${trackId}`);
            const response = await fetch(url, { headers: getAudiusHeaders() });
            if (!response.ok) return null;
            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('Error fetching track:', error);
            return null;
        }
    },

    // Search Audius catalog
    async searchTracks(query) {
        if (!query || query.trim().length === 0) {
            return [];
        }
        
        try {
            const url = getAudiusUrl(`/v1/tracks/search?query=${encodeURIComponent(query)}&limit=20`);
            const response = await fetch(url, { headers: getAudiusHeaders() });
            if (!response.ok) return [];
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error('Search error:', error);
            return [];
        }
    },

    // Get artist's coin mint address
    async getArtistCoin(artistId) {
        // Check cache first
        if (this._cachedArtistCoins[artistId] !== undefined) {
            return this._cachedArtistCoins[artistId];
        }
        
        try {
            const data = await proxyFetch(`/api/v1/audius/user/${artistId}/coins`);
            
            // Find artist's own coin (where owner_id matches artistId)
            // Filter out $AUDIO token (9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM)
            const artistCoin = data.data?.data?.find(coin => 
                coin.owner_id === artistId && 
                coin.mint !== '9LzCMqDgTKYz9Drzqnpgee3SGa89up3a247ypMj2xrqM'
            );
            
            this._cachedArtistCoins[artistId] = artistCoin || null;
            return artistCoin;
        } catch (error) {
            console.error('Error fetching artist coin:', error);
            this._cachedArtistCoins[artistId] = null;
            return null;
        }
    },

    // SOLANA: Connect wallet (using Phantom-compatible interface)
    // CLEAN: Clear error handling for all wallet scenarios
    async connectWallet() {
        console.log('🔗 Connecting Solana wallet...');
        
        // Check for injected wallet (Phantom, Backpack, Glow, etc.)
        const provider = window.phantom?.solana || window.solana;
        
        if (!provider) {
            // CLEAN: Return null so UI can show install prompt
            console.warn('No Solana wallet found');
            return null;
        }
        
        // Check if already connected
        if (provider.isConnected) {
            const address = provider.publicKey.toString();
            this.wallet = { address, provider: 'phantom' };
            this.connected = true;
            console.log('✅ Already connected:', address);
            return this.wallet;
        }

        try {
            // Request connection
            const response = await provider.connect();
            this.wallet = {
                address: response.publicKey.toString(),
                provider: 'phantom'
            };
            this.connected = true;
            console.log('✅ Wallet connected:', this.wallet.address);
            return this.wallet;
        } catch (error) {
            console.error('Wallet connection error:', error);
            // CLEAN: Return null - UI handles error display
            return null;
        }
    },

    // Disconnect wallet
    disconnectWallet() {
        this.wallet = null;
        this.connected = false;
        this.ownedCoins = [];
        console.log('🔓 Wallet disconnected');
    },

    // Verify coin ownership for version access
    // CLEAN: Uses Solana RPC to verify actual token ownership
    async verifyOwnership(artistCoinAddress) {
        if (!this.connected || !this.wallet) {
            return { owned: false, message: 'Connect wallet first' };
        }

        // Try to verify via Solana RPC with multiple fallback endpoints
        try {
            const result = await this.checkSolanaTokenBalance(artistCoinAddress);
            return result;
        } catch (error) {
            console.error('❌ All RPC endpoints failed:', error);
            // Return error state instead of mock
            return {
                owned: false,
                message: 'Unable to verify ownership - RPC unavailable',
                error: error.message
            };
        }
    },

    // CLEAN: Query Solana RPC for token balance with fallback endpoints
    async checkSolanaTokenBalance(tokenMintAddress) {
        // Validate that this looks like a real Solana address (base58, 32-44 chars)
        if (!tokenMintAddress || tokenMintAddress.length < 32 || tokenMintAddress.includes('_')) {
            console.log(`ℹ️ ${tokenMintAddress} is not a valid Solana mint address (Artist Coins not yet deployed)`);
            return {
                owned: false,
                balance: 0,
                wallet: this.wallet.address,
                message: 'Artist Coin not yet deployed as SPL token'
            };
        }
        
        try {
            console.log(`🔍 Checking token balance via proxy...`);
            
            const response = await fetch(`${API_PROXY}/api/v1/solana/rpc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [
                        this.wallet.address,
                        { mint: tokenMintAddress },
                        { encoding: 'jsonParsed' }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                console.warn(`❌ RPC error:`, data.error.message);
                throw new Error(data.error.message);
            }
            
            if (data.result && data.result.value && data.result.value.length > 0) {
                // Found token account with balance
                const tokenInfo = data.result.value[0];
                const balance = tokenInfo.account.data.parsed.info.tokenAmount?.uiAmount || 0;
                
                console.log(`✅ Token balance found: ${balance}`);
                return {
                    owned: balance > 0,
                    balance: balance,
                    wallet: this.wallet.address,
                    message: balance > 0 ? `Owned ${balance} tokens` : 'No tokens found'
                };
            }

            // No token account found
            console.log(`ℹ️ No token account found`);
            return {
                owned: false,
                balance: 0,
                wallet: this.wallet.address,
                message: 'No token account found'
            };
            
        } catch (error) {
            console.error('❌ RPC check failed:', error);
            throw error;
        }
    },

    // Fallback mock check for demo purposes
    _mockOwnershipCheck(artistCoinAddress) {
        // For demo: wallet connection = access granted
        // This shows the concept without hitting RPC rate limits
        const owned = true; // Connected wallet gets access
        
        return {
            owned,
            wallet: this.wallet.address,
            message: owned ? '✅ Access granted (Demo mode - wallet connected)' : 'No ownership found'
        };
    },

    // Mock owned coins for demo purposes
    getMockOwnedCoins() {
        return this.ownedCoins.length > 0 ? this.ownedCoins : [
            { address: 'DemoArtistCoin123', symbol: 'DEMO', name: 'Demo Artist' }
        ];
    },

    // Set owned coins (for testing/demo)
    setOwnedCoins(coins) {
        this.ownedCoins = coins;
    },

    // Link version to Audius track/artist coin
    async linkVersionToCoin(versionId, audiusTrackId, artistCoinAddress) {
        console.log(`🔗 Linking version ${versionId} to Audius track ${audiusTrackId}`);
        return {
            success: true,
            versionId,
            audiusTrackId,
            artistCoinAddress,
            message: 'Version linked to artist coin'
        };
    },

    // Check if user can access a version
    async checkVersionAccess(versionId) {
        if (!this.connected) {
            return { access: false, reason: 'Connect wallet to access' };
        }
        return { access: true, reason: 'Demo mode - full access' };
    },

    // UI: Show wallet install prompt
    showWalletInstallPrompt() {
        console.warn('No wallet - UI should show install prompt');
    }
};
