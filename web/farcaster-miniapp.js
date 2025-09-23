// Farcaster Mini App SDK Integration for VERSIONS
// Following official Farcaster Mini App patterns from llms.txt documentation

class FarcasterMiniApp {
    constructor() {
        this.sdk = null;
        this.isInFarcaster = this.detectFarcasterContext();
        this.isReady = false;
        this.context = null;
        this.user = null;
        
        // Initialize SDK if in Farcaster environment
        this.init();
    }

    /**
     * CLEAN: Detect if running in Farcaster Mini App context
     */
    detectFarcasterContext() {
        // Check URL params for Farcaster context indicators
        const url = new URL(window.location.href);
        return url.searchParams.has('miniApp') || 
               url.pathname.includes('/miniapp') ||
               window.parent !== window; // Running in iframe
    }

    /**
     * MODULAR: Initialize Farcaster SDK
     */
    async init() {
        console.log('🎭 Initializing Farcaster Mini App integration...');
        
        if (!this.isInFarcaster) {
            console.log('📱 Not in Farcaster context - using web mode');
            this.setupWebMode();
            return;
        }

        try {
            // Import Farcaster Mini App SDK
            const { sdk } = await import('https://esm.sh/@farcaster/miniapp-sdk');
            this.sdk = sdk;
            
            // Get context information
            this.context = sdk.context;
            console.log('🔗 Farcaster context:', this.context);
            
            // ENHANCEMENT: Handle different launch contexts
            this.handleLaunchContext();
            
            // Mark app as ready (required to hide splash screen)
            await this.markReady();
            
            console.log('✅ Farcaster Mini App initialized');
            
        } catch (error) {
            console.warn('⚠️ Failed to load Farcaster SDK, using fallback:', error);
            this.setupWebMode();
        }
    }

    /**
     * CLEAN: Handle different launch contexts
     */
    handleLaunchContext() {
        if (!this.context) return;
        
        switch (this.context.location.type) {
            case 'cast_share':
                this.handleSharedCast(this.context.location.cast);
                break;
            case 'notification':
                this.handleNotificationLaunch(this.context.location.notification);
                break;
            default:
                console.log('📱 Standard launch');
        }
    }

    /**
     * ENHANCEMENT: Handle shared cast from share extension
     */
    handleSharedCast(cast) {
        console.log('🎵 Received shared cast:', cast);
        
        // Show notification about shared content
        this.showSystemMessage(`Analyzing cast from @${cast.author.username || cast.author.fid}`);
        
        // Extract music-related content from cast
        if (cast.text.match(/\b(song|album|artist|music|version|demo|live|remix)\b/i)) {
            this.showSystemMessage('🎭 Music content detected - analyzing for versions...');
            this.analyzeCastForVersions(cast);
        }
    }

    /**
     * MODULAR: Handle notification launch
     */
    handleNotificationLaunch(notification) {
        console.log('🔔 Launched from notification:', notification);
        this.showSystemMessage(`Opened from: ${notification.title}`);
    }

    /**
     * PERFORMANT: Mark app as ready (required by Farcaster)
     */
    async markReady() {
        if (!this.sdk) return;
        
        try {
            await this.sdk.actions.ready();
            this.isReady = true;
            console.log('✅ Farcaster splash screen hidden');
        } catch (error) {
            console.error('❌ Failed to mark app ready:', error);
        }
    }

    /**
     * CLEAN: Setup web mode when not in Farcaster
     */
    setupWebMode() {
        console.log('🌐 Running in web mode');
        this.isReady = true;
        
        // Show web-specific features
        this.showWebFeatures();
    }

    /**
     * MODULAR: Authenticate user with Sign In with Farcaster
     */
    async signIn() {
        if (!this.sdk) {
            this.showSystemMessage('❌ Farcaster SDK not available');
            return null;
        }

        try {
            this.showSystemMessage('🔐 Signing in with Farcaster...');
            
            const result = await this.sdk.actions.signIn({
                acceptAuthAddress: true // Support auth addresses for better UX
            });
            
            this.user = {
                fid: result.fid,
                username: result.username,
                displayName: result.displayName,
                pfpUrl: result.pfpUrl
            };
            
            this.showSystemMessage(`✅ Signed in as @${result.username}`);
            
            // Update UI with user context
            this.updateUIWithUser();
            
            return this.user;
            
        } catch (error) {
            console.error('🚨 Sign in failed:', error);
            this.showSystemMessage('❌ Sign in failed - please try again');
            return null;
        }
    }

    /**
     * SOCIAL: Share version discovery to Farcaster
     */
    async shareVersionDiscovery(versionInfo) {
        if (!this.sdk) {
            this.showSystemMessage('❌ Sharing not available in web mode');
            return;
        }

        try {
            const castText = `🎭 Just discovered an amazing version on VERSIONS!\n\n${versionInfo.title} by ${versionInfo.artist}\nType: ${versionInfo.version_type}\n\nDiscover more rare recordings:`;
            
            await this.sdk.actions.composeCast({
                text: castText,
                embeds: [window.location.href]
            });
            
            this.showSystemMessage('📤 Shared to Farcaster feed!');
            
        } catch (error) {
            console.error('🚨 Sharing failed:', error);
            this.showSystemMessage('❌ Sharing failed - please try again');
        }
    }

    /**
     * SOCIAL: Add app to user's collection
     */
    async addToCollection() {
        if (!this.sdk) {
            this.showSystemMessage('❌ Add to collection not available in web mode');
            return;
        }

        try {
            await this.sdk.actions.addMiniApp();
            this.showSystemMessage('⭐ Added VERSIONS to your app collection!');
            
        } catch (error) {
            console.error('🚨 Add to collection failed:', error);
            this.showSystemMessage('❌ Failed to add to collection');
        }
    }

    /**
     * ENHANCEMENT: View Farcaster profile
     */
    async viewProfile(fid) {
        if (!this.sdk) return;

        try {
            await this.sdk.actions.viewProfile(fid);
        } catch (error) {
            console.error('🚨 View profile failed:', error);
        }
    }

    /**
     * MODULAR: Analyze cast for music versions
     */
    async analyzeCastForVersions(cast) {
        // Extract potential song/artist info from cast text
        const musicMatches = cast.text.match(/(?:song|track|version|demo|live|remix|cover):\s*(.+?)(?:\s|$)/i);
        
        if (musicMatches) {
            const potentialSong = musicMatches[1];
            this.showSystemMessage(`🔍 Searching for versions of: "${potentialSong}"`);
            
            // Trigger search in the main app
            if (window.runCommand) {
                setTimeout(() => {
                    window.runCommand(`search ${potentialSong}`);
                }, 1000);
            }
        }
    }

    /**
     * CLEAN: Show system message in terminal
     */
    showSystemMessage(message) {
        console.log(`[FARCASTER] ${message}`);
        
        // Update info display
        if (window.updateInfo) {
            window.updateInfo(message);
        }
        
        // Show temporary notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: rgba(0, 212, 255, 0.9);
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 0.9rem;
            z-index: 1002;
            animation: slideIn 0.3s ease;
            max-width: 300px;
        `;
        
        notification.textContent = message;
        document.body.appendChild(notification);
        
        // Remove after 4 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 4000);
    }

    /**
     * ENHANCEMENT: Update UI with user context
     */
    updateUIWithUser() {
        if (!this.user) return;

        // Add user indicator to header
        const header = document.querySelector('.header .status');
        if (header) {
            const userStatus = document.createElement('div');
            userStatus.className = 'status-item';
            userStatus.innerHTML = `
                <img src="${this.user.pfpUrl}" alt="Profile" style="width: 16px; height: 16px; border-radius: 50%;">
                <span>@${this.user.username}</span>
            `;
            header.appendChild(userStatus);
        }

        // Enable social features
        this.enableSocialFeatures();
    }

    /**
     * MODULAR: Enable social features when authenticated
     */
    enableSocialFeatures() {
        // Add share button to version discovery sidebar
        const sidebarHeader = document.querySelector('.sidebar-header');
        if (sidebarHeader) {
            const shareButton = document.createElement('button');
            shareButton.className = 'control-btn';
            shareButton.style.marginLeft = '10px';
            shareButton.innerHTML = '📤 Share';
            shareButton.onclick = () => this.shareCurrentDiscovery();
            sidebarHeader.appendChild(shareButton);
        }

        // Update social indicator
        const socialIndicator = document.querySelector('.social-indicator');
        if (socialIndicator) {
            socialIndicator.innerHTML = `
                <div class="social-pulse"></div>
                <span>Connected to Farcaster</span>
            `;
        }
    }

    /**
     * SOCIAL: Share current discovery
     */
    async shareCurrentDiscovery() {
        // Get current song/version being viewed
        const currentVersion = {
            title: 'Amazing Version Discovery',
            artist: 'Various Artists',
            version_type: 'Live'
        };
        
        await this.shareVersionDiscovery(currentVersion);
    }

    /**
     * CLEAN: Show web-specific features
     */
    showWebFeatures() {
        // Add "Get on Farcaster" button
        const controls = document.querySelector('.controls .control-group:last-child');
        if (controls) {
            const farcasterButton = document.createElement('button');
            farcasterButton.className = 'control-btn';
            farcasterButton.innerHTML = '🎭 Get on Farcaster';
            farcasterButton.onclick = () => {
                window.open('https://farcaster.xyz', '_blank');
            };
            controls.appendChild(farcasterButton);
        }

        // Show web notification
        setTimeout(() => {
            this.showSystemMessage('💡 Try VERSIONS on Farcaster for full social features!');
        }, 5000);
    }

    /**
     * PERFORMANT: Get recommendations from Farcaster social graph
     */
    async getSocialRecommendations() {
        if (!this.user) {
            console.log('👤 User not signed in - cannot get social recommendations');
            return [];
        }

        try {
            const config = window.getConfig ? window.getConfig() : { apiBase: 'http://localhost:8080' };
            const response = await fetch(`${config.apiBase}/api/v1/farcaster/recommendations?fid=${this.user.fid}`);
            
            if (response.ok) {
                const data = await response.json();
                return data.data || [];
            } else {
                console.warn('⚠️ Failed to fetch social recommendations');
                return [];
            }
        } catch (error) {
            console.error('🚨 Error fetching social recommendations:', error);
            return [];
        }
    }
}

// Add animation styles for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// MODULAR: Export for global use
window.FarcasterMiniApp = FarcasterMiniApp;

// ENHANCEMENT: Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    if (!window.farcasterApp) {
        window.farcasterApp = new FarcasterMiniApp();
    }
});

console.log('🎭 Farcaster Mini App SDK integration loaded');