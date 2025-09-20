// MODULAR: Wallet connection module for VERSIONS
// CLEAN: Abstracts wallet complexity from the main app
class WalletManager {
    constructor() {
        this.isConnected = false;
        this.account = null;
        this.provider = null;
        this.signer = null;
        this.network = 'calibration'; // Start with Filecoin testnet
        this.connectionCache = new Map();
    }
    // PERFORMANT: Check if wallet is available
    isWalletAvailable() {
        return typeof window.ethereum !== 'undefined';
    }
    // CLEAN: Connect to wallet with proper error handling
    async connectWallet() {
        try {
            if (!this.isWalletAvailable()) {
                throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.');
            }
            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });
            if (accounts.length === 0) {
                throw new Error('No accounts found. Please unlock your wallet.');
            }
            this.account = accounts[0];
            this.isConnected = true;
            // CLEAN: Set up provider and signer
            await this.setupProvider();
            // MODULAR: Switch to Filecoin network if needed
            await this.ensureFilecoinNetwork();
            console.log('🔗 Wallet connected:', this.account);
            return {
                success: true,
                account: this.account,
                network: this.network
            };
        }
        catch (error) {
            console.error('Wallet connection failed:', error);
            throw error;
        }
    }
    // CLEAN: Setup provider and signer
    async setupProvider() {
        try {
            // Use ethers.js for provider setup
            const { ethers } = await (new Function('return import("https://esm.sh/ethers@6.14.3")')());
            this.provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await this.provider.getSigner();
            // Listen for account changes
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    this.disconnect();
                }
                else {
                    this.account = accounts[0];
                    this.onAccountChanged(accounts[0]);
                }
            });
            // Listen for network changes
            window.ethereum.on('chainChanged', (chainId) => {
                this.onNetworkChanged(chainId);
            });
        }
        catch (error) {
            console.error('Provider setup failed:', error);
            throw error;
        }
    }
    // MODULAR: Ensure we're on Filecoin network
    async ensureFilecoinNetwork() {
        try {
            const filecoinNetworks = {
                calibration: {
                    chainId: '0x4cb2f', // 314159 in hex
                    chainName: 'Filecoin Calibration',
                    nativeCurrency: {
                        name: 'Test Filecoin',
                        symbol: 'tFIL',
                        decimals: 18
                    },
                    rpcUrls: ['https://api.calibration.node.glif.io/rpc/v1'],
                    blockExplorerUrls: ['https://calibration.filscan.io/']
                },
                mainnet: {
                    chainId: '0x13a', // 314 in hex
                    chainName: 'Filecoin Mainnet',
                    nativeCurrency: {
                        name: 'Filecoin',
                        symbol: 'FIL',
                        decimals: 18
                    },
                    rpcUrls: ['https://api.node.glif.io/rpc/v1'],
                    blockExplorerUrls: ['https://filscan.io/']
                }
            };
            const targetNetwork = filecoinNetworks[this.network];
            try {
                // Try to switch to the network
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetNetwork.chainId }]
                });
            }
            catch (switchError) {
                // If network doesn't exist, add it
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [targetNetwork]
                    });
                }
                else {
                    throw switchError;
                }
            }
            console.log(`🌍 Connected to Filecoin ${this.network}`);
        }
        catch (error) {
            console.warn('Failed to switch to Filecoin network:', error);
            // Continue anyway - user can switch manually
        }
    }
    // CLEAN: Disconnect wallet
    disconnect() {
        this.isConnected = false;
        this.account = null;
        this.provider = null;
        this.signer = null;
        this.connectionCache.clear();
        console.log('🔌 Wallet disconnected');
        this.onDisconnected();
    }
    // MODULAR: Get wallet balance
    async getBalance() {
        try {
            if (!this.provider || !this.account) {
                throw new Error('Wallet not connected');
            }
            const balance = await this.provider.getBalance(this.account);
            const { ethers } = await (new Function('return import("https://esm.sh/ethers@6.14.3")')());
            return {
                wei: balance.toString(),
                fil: ethers.formatEther(balance),
                formatted: `${parseFloat(ethers.formatEther(balance)).toFixed(4)} FIL`
            };
        }
        catch (error) {
            console.error('Failed to get balance:', error);
            return { wei: '0', fil: '0', formatted: '0 FIL' };
        }
    }
    // CLEAN: Get network info
    async getNetworkInfo() {
        try {
            if (!this.provider) {
                throw new Error('Provider not available');
            }
            const network = await this.provider.getNetwork();
            return {
                chainId: network.chainId.toString(),
                name: network.name,
                isFilecoin: network.chainId === 314n || network.chainId === 314159n
            };
        }
        catch (error) {
            console.error('Failed to get network info:', error);
            return { chainId: 'unknown', name: 'unknown', isFilecoin: false };
        }
    }
    // MODULAR: Sign message for authentication
    async signMessage(message) {
        try {
            if (!this.signer) {
                throw new Error('Signer not available');
            }
            const signature = await this.signer.signMessage(message);
            return signature;
        }
        catch (error) {
            console.error('Message signing failed:', error);
            throw error;
        }
    }
    // ENHANCEMENT: Event handlers (can be overridden)
    onAccountChanged(account) {
        console.log('🔄 Account changed:', account);
        // Override in subclass or add event listeners
    }
    onNetworkChanged(chainId) {
        console.log('🔄 Network changed:', chainId);
        // Override in subclass or add event listeners
    }
    onDisconnected() {
        console.log('🔌 Wallet disconnected');
        // Override in subclass or add event listeners
    }
    // CLEAN: Utility methods
    getWalletStatus() {
        return {
            available: this.isWalletAvailable(),
            connected: this.isConnected,
            account: this.account,
            network: this.network
        };
    }
    // PERFORMANT: Clear cache
    clearCache() {
        this.connectionCache.clear();
    }
    // MODULAR: Switch network
    async switchNetwork(networkName) {
        this.network = networkName;
        await this.ensureFilecoinNetwork();
    }
    // CLEAN: Get current account safely
    getCurrentAccount() {
        return this.account;
    }
    // MODULAR: Check if on correct network
    async isOnFilecoinNetwork() {
        const networkInfo = await this.getNetworkInfo();
        return networkInfo.isFilecoin;
    }
}
// MODULAR: Export singleton instance
export const walletManager = new WalletManager();
// DRY: Export class and types
export { WalletManager };
//# sourceMappingURL=wallet-connection.js.map