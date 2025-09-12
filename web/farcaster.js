// MODULAR: Farcaster integration module
// CLEAN: Separate Farcaster logic from main app

import { appConfig } from './config.js';

class FarcasterManager {
    constructor() {
        this.sdk = null;
        this.user = null;
        this.isAuthenticated = false;
        // PERFORMANT: Cache user data
        this.userCache = new Map();
    }

    // PERFORMANT: Lazy load SDK
    async loadSDK() {
        if (!this.sdk) {
            try {
                const module = await import('https://esm.sh/@farcaster/miniapp-sdk');
                this.sdk = module.sdk;
                
                // CLEAN: Initialize Mini App
                await this.sdk.actions.ready();
                console.log('🟣 Farcaster Mini App ready!');
                
                return true;
            } catch (error) {
                console.log('Running outside Farcaster environment:', error.message);
                return false;
            }
        }
        return true;
    }

    // CLEAN: Check if running in Farcaster
    isFarcasterEnvironment() {
        return window.parent !== window || 
               window.location.search.includes('miniApp=true') ||
               window.location.search.includes('farcaster=true');
    }

    // ENHANCEMENT: Enhanced authentication with user context
    async authenticate() {
        try {
            const sdkLoaded = await this.loadSDK();
            if (!sdkLoaded || !this.sdk) {
                throw new Error('Farcaster SDK not available');
            }

            const result = await this.sdk.actions.signIn();
            
            // PERFORMANT: Store user data
            this.user = {
                fid: result.fid,
                username: result.username,
                displayName: result.displayName,
                bio: result.bio,
                pfpUrl: result.pfpUrl
            };
            
            this.isAuthenticated = true;
            
            // MODULAR: Fetch additional profile data from our API
            await this.fetchUserProfile(result.fid);
            
            console.log('🟣 Farcaster authentication successful:', this.user);
            return this.user;
            
        } catch (error) {
            console.error('Farcaster authentication failed:', error);
            throw error;
        }
    }

    // MODULAR: Fetch user profile from our API
    async fetchUserProfile(fid) {
        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/farcaster/profile/${fid}`);
            const data = await response.json();
            
            if (data.success) {
                // ENHANCEMENT: Merge API data with SDK data
                this.user = { ...this.user, ...data.data };
                this.userCache.set(fid, data.data);
            }
        } catch (error) {
            console.warn('Failed to fetch additional profile data:', error);
        }
    }

    // MODULAR: Cast a version discovery
    async castVersionDiscovery(versionData) {
        try {
            if (!this.sdk) {
                throw new Error('Farcaster SDK not loaded');
            }

            const text = `🎭 Just discovered an incredible ${versionData.version_type.toLowerCase()} version of "${versionData.title}"! 

🎵 Compare versions: ${window.location.origin}/compare/${versionData.id}

#VersionDiscovery #${versionData.artist.replace(/\s+/g, '')} #VERSIONS`;

            // CLEAN: Use SDK to compose cast
            await this.sdk.actions.composeCast({
                text: text,
                embeds: [`${window.location.origin}/versions/${versionData.id}`]
            });

            // MODULAR: Also call our API to track the cast
            await this.trackCast(text, versionData.id);
            
            return true;
        } catch (error) {
            console.error('Failed to cast version discovery:', error);
            throw error;
        }
    }

    // MODULAR: Track cast in our system
    async trackCast(text, versionId) {
        try {
            await fetch(`${appConfig.apiBase}/api/v1/farcaster/cast`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    embed_url: `${window.location.origin}/versions/${versionId}`
                })
            });
        } catch (error) {
            console.warn('Failed to track cast:', error);
        }
    }

    // MODULAR: Get social recommendations
    async getSocialRecommendations() {
        if (!this.isAuthenticated) {
            return [];
        }

        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/farcaster/recommendations?fid=${this.user.fid}`);
            const data = await response.json();
            
            return data.success ? data.data : [];
        } catch (error) {
            console.error('Failed to get social recommendations:', error);
            return [];
        }
    }

    // MODULAR: Get version discussions
    async getVersionDiscussions(versionId) {
        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/versions/${versionId}/discussions`);
            const data = await response.json();
            
            return data.success ? data.data : [];
        } catch (error) {
            console.error('Failed to get version discussions:', error);
            return [];
        }
    }

    // CLEAN: Get current user
    getCurrentUser() {
        return this.user;
    }

    // CLEAN: Check authentication status
    isUserAuthenticated() {
        return this.isAuthenticated;
    }
}

// MODULAR: Export singleton instance
export const farcasterManager = new FarcasterManager();