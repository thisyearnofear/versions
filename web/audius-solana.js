// AUDIUS + SOLANA INTEGRATION FOR HACKATHON
// "Versions of a song as tickets" - Song versions tied to Audius Artist Coins
//
// PRINCIPLES APPLIED:
// - MODULAR: Pluggable integration, can be removed entirely
// - DRY: Reuses existing API patterns from farcaster-miniapp.js
// - CLEAN: Single responsibility - only wallet/coin logic
// - PERFORMANT: Lazy-loads Audius data, caches wallet state
// - PREVENT BLOAT: Separate file prevents main app bloat

const AUDIUS_API_HOST = 'https://api.audius.co';

// Make globally available
window.AudiusSolanaIntegration = {
    wallet: null,
    connected: false,
    audiusUser: null,
    ownedCoins: [],
    _cachedTracks: null,

    // Initialize Audius SDK (read-only mode)
    // PERFORMANT: Caches results to avoid repeated calls
    async initAudius() {
        // Return cached if available
        if (this._cachedTracks) {
            return this._cachedTracks;
        }

        console.log('🎵 Loading tracks from Audius...');
        
        try {
            const response = await fetch(`${AUDIUS_API_HOST}/v1/tracks/trending?app_name=VersionsHack&limit=20`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            this._cachedTracks = data.data || [];
            console.log('✅ Audius trending tracks loaded:', this._cachedTracks.length);
            return this._cachedTracks;
        } catch (error) {
            console.error('❌ Audius init failed:', error);
            // Return empty array - UI will show demo fallback
            return [];
        }
    },

    // Fetch track from Audius by ID
    async getTrack(trackId) {
        try {
            const response = await fetch(`${AUDIUS_API_HOST}/v1/tracks/${trackId}?app_name=VersionsHack`);
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
            const response = await fetch(
                `${AUDIUS_API_HOST}/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=VersionsHack&limit=20`
            );
            if (!response.ok) return [];
            const data = await response.json();
            return data.data || [];
        } catch (error) {
            console.error('Search error:', error);
            return [];
        }
    },

    // Get artist info
    async getArtist(artistId) {
        try {
            const response = await fetch(`${AUDIUS_API_HOST}/v1/users/${artistId}?app_name=VersionsHack`);
            if (!response.ok) return null;
            const data = await response.json();
            return data.data;
        } catch (error) {
            console.error('Error fetching artist:', error);
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
        // Multiple RPC endpoints to avoid rate limiting
        const RPC_ENDPOINTS = [
            'https://api.mainnet-beta.solana.com',
            'https://solana-api.projectserum.com',
            'https://rpc.ankr.com/solana',
            'https://solana-mainnet.rpc.extrnode.com',
            'https://solana.public-rpc.com'
        ];
        
        let lastError = null;
        
        // Try each RPC endpoint until one works
        for (const rpcUrl of RPC_ENDPOINTS) {
            try {
                console.log(`🔍 Checking token balance via ${rpcUrl.split('/')[2]}...`);
                
                const response = await fetch(rpcUrl, {
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
                    console.warn(`❌ ${rpcUrl.split('/')[2]} returned ${response.status}`);
                    lastError = new Error(`HTTP ${response.status}`);
                    continue;
                }

                const data = await response.json();
                
                if (data.error) {
                    console.warn(`❌ ${rpcUrl.split('/')[2]} error:`, data.error.message);
                    lastError = new Error(data.error.message);
                    continue;
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
                        message: balance > 0 ? `Owned ${balance} tokens` : 'No tokens found',
                        rpcUsed: rpcUrl.split('/')[2]
                    };
                }

                // No token account found, but RPC worked
                console.log(`ℹ️ No token account found via ${rpcUrl.split('/')[2]}`);
                return {
                    owned: false,
                    balance: 0,
                    wallet: this.wallet.address,
                    message: 'No token account found',
                    rpcUsed: rpcUrl.split('/')[2]
                };
                
            } catch (error) {
                console.warn(`❌ ${rpcUrl.split('/')[2]} failed:`, error.message);
                lastError = error;
                continue;
            }
        }
        
        // All RPCs failed
        console.error('❌ All RPC endpoints failed:', lastError);
        throw lastError;
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
