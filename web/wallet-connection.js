// MODULAR: Wallet connection module for VERSIONS
// CLEAN: Abstracts wallet complexity from the main app

import { appConfig } from './config.js';

class WalletManager {
    constructor() {
        this.isConnected = false;
        this.account = null;
        this.provider = null;
        this.signer = null;
        this.network = 'calibration'; // Start with Filecoin testnet
        // PERFORMANT: Cache wallet state
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

        } catch (error) {
            console.error('Wallet connection failed:', error);
            throw error;
        }
    }

    // CLEAN: Setup provider and signer
    async setupProvider() {
        try {
            // Use ethers.js for provider setup
            const { ethers } = await import('https://esm.sh/ethers@6.14.3');
            
            this.provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await this.provider.getSigner();

            // Listen for account changes
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    this.disconnect();
                } else {
                    this.account = accounts[0];
                    this.onAccountChanged(accounts[0]);
                }
            });

            // Listen for network changes
            window.ethereum.on('chainChanged', (chainId) => {
                this.onNetworkChanged(chainId);
            });

        } catch (error) {
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
            } catch (switchError) {
                // If network doesn't exist, add it
                if (switchError.code === 4902) {
                    await window.ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [targetNetwork]
                    });
                } else {
                    throw switchError;
                }
            }

            console.log(`🌍 Connected to Filecoin ${this.network}`);

        } catch (error) {
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
            const { ethers } = await import('https://esm.sh/ethers@6.14.3');
            
            return {
                wei: balance.toString(),
                fil: ethers.formatEther(balance),
                formatted: `${parseFloat(ethers.formatEther(balance)).toFixed(4)} FIL`
            };

        } catch (error) {
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

        } catch (error) {
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

        } catch (error) {
            console.error('Message signing failed:', error);
            throw error;
        }
    }

    // CLEAN: Event handlers (to be overridden)
    onAccountChanged(newAccount) {
        console.log('👤 Account changed:', newAccount);
        // Override in main app
    }

    onNetworkChanged(chainId) {
        console.log('🌐 Network changed:', chainId);
        // Override in main app
    }

    onDisconnected() {
        console.log('🔌 Wallet disconnected');
        // Override in main app
    }

    // PERFORMANT: Check connection status
    async checkConnection() {
        try {
            if (!this.isWalletAvailable()) {
                return false;
            }

            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });

            if (accounts.length > 0) {
                this.account = accounts[0];
                this.isConnected = true;
                await this.setupProvider();
                return true;
            }

            return false;

        } catch (error) {
            console.error('Connection check failed:', error);
            return false;
        }
    }

    // CLEAN: Get connection status
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            account: this.account,
            network: this.network,
            hasWallet: this.isWalletAvailable()
        };
    }
}

// MODULAR: Export singleton instance
export const walletManager = new WalletManager();

// CLEAN: Helper functions for UI integration
export const WalletHelpers = {
    // CLEAN: Format address for display
    formatAddress(address) {
        if (!address) return 'Not connected';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    },

    // CLEAN: Format balance for display
    formatBalance(balance) {
        if (!balance || !balance.fil) return '0 FIL';
        const fil = parseFloat(balance.fil);
        if (fil < 0.001) return '< 0.001 FIL';
        return `${fil.toFixed(3)} FIL`;
    },

    // CLEAN: Get network display name
    getNetworkDisplayName(chainId) {
        const networks = {
            '314': 'Filecoin Mainnet',
            '314159': 'Filecoin Calibration',
            '1': 'Ethereum Mainnet',
            '11155111': 'Ethereum Sepolia'
        };
        return networks[chainId] || `Network ${chainId}`;
    },

    // CLEAN: Check if network is supported
    isSupportedNetwork(chainId) {
        return ['314', '314159'].includes(chainId.toString());
    }
};