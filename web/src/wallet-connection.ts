// MODULAR: Wallet connection module for VERSIONS
// CLEAN: Abstracts wallet complexity from the main app

import { appConfig } from './config';

// CLEAN: Types for wallet integration
interface WalletConnection {
    success: boolean;
    account: string;
    network: string;
}

interface NetworkInfo {
    chainId: string;
    name: string;
    isFilecoin: boolean;
}

interface BalanceInfo {
    wei: string;
    fil: string;
    formatted: string;
}

interface FilecoinNetwork {
    chainId: string;
    chainName: string;
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    rpcUrls: string[];
    blockExplorerUrls: string[];
}

// CLEAN: Ethereum provider types
interface EthereumProvider {
    request(args: { method: string; params?: any[] }): Promise<any>;
    on(event: string, handler: (...args: any[]) => void): void;
    removeListener(event: string, handler: (...args: any[]) => void): void;
}

declare global {
    interface Window {
        ethereum?: EthereumProvider;
    }
}

class WalletManager {
    public isConnected: boolean;
    public account: string | null;
    public provider: any | null; // ethers provider
    public signer: any | null; // ethers signer
    public network: string;
    // PERFORMANT: Cache wallet state
    private connectionCache: Map<string, any>;

    constructor() {
        this.isConnected = false;
        this.account = null;
        this.provider = null;
        this.signer = null;
        this.network = 'calibration'; // Start with Filecoin testnet
        this.connectionCache = new Map();
    }

    // PERFORMANT: Check if wallet is available
    isWalletAvailable(): boolean {
        return typeof window.ethereum !== 'undefined';
    }

    // CLEAN: Connect to wallet with proper error handling
    async connectWallet(): Promise<WalletConnection> {
        try {
            if (!this.isWalletAvailable()) {
                throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.');
            }

            // Request account access
            const accounts = await window.ethereum!.request({
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
                account: this.account!,
                network: this.network
            };

        } catch (error) {
            console.error('Wallet connection failed:', error);
            throw error;
        }
    }

    // CLEAN: Setup provider and signer
    private async setupProvider(): Promise<void> {
        try {
            // Use ethers.js for provider setup
            const { ethers } = await (new Function('return import("https://esm.sh/ethers@6.14.3")')()) as any;
            
            this.provider = new ethers.BrowserProvider(window.ethereum!);
            this.signer = await this.provider.getSigner();

            // Listen for account changes
            window.ethereum!.on('accountsChanged', (accounts: string[]) => {
                if (accounts.length === 0) {
                    this.disconnect();
                } else {
                    this.account = accounts[0];
                    this.onAccountChanged(accounts[0]);
                }
            });

            // Listen for network changes
            window.ethereum!.on('chainChanged', (chainId: string) => {
                this.onNetworkChanged(chainId);
            });

        } catch (error) {
            console.error('Provider setup failed:', error);
            throw error;
        }
    }

    // MODULAR: Ensure we're on Filecoin network
    private async ensureFilecoinNetwork(): Promise<void> {
        try {
            const filecoinNetworks: Record<string, FilecoinNetwork> = {
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
                await window.ethereum!.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: targetNetwork.chainId }]
                });
            } catch (switchError: any) {
                // If network doesn't exist, add it
                if (switchError.code === 4902) {
                    await window.ethereum!.request({
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
    disconnect(): void {
        this.isConnected = false;
        this.account = null;
        this.provider = null;
        this.signer = null;
        this.connectionCache.clear();
        
        console.log('🔌 Wallet disconnected');
        this.onDisconnected();
    }

    // MODULAR: Get wallet balance
    async getBalance(): Promise<BalanceInfo> {
        try {
            if (!this.provider || !this.account) {
                throw new Error('Wallet not connected');
            }

            const balance = await this.provider.getBalance(this.account);
            const { ethers } = await (new Function('return import("https://esm.sh/ethers@6.14.3")')()) as any;
            
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
    async getNetworkInfo(): Promise<NetworkInfo> {
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
    async signMessage(message: string): Promise<string> {
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

    // ENHANCEMENT: Event handlers (can be overridden)
    protected onAccountChanged(account: string): void {
        console.log('🔄 Account changed:', account);
        // Override in subclass or add event listeners
    }

    protected onNetworkChanged(chainId: string): void {
        console.log('🔄 Network changed:', chainId);
        // Override in subclass or add event listeners
    }

    protected onDisconnected(): void {
        console.log('🔌 Wallet disconnected');
        // Override in subclass or add event listeners
    }

    // CLEAN: Utility methods
    getWalletStatus(): {
        available: boolean;
        connected: boolean;
        account: string | null;
        network: string;
    } {
        return {
            available: this.isWalletAvailable(),
            connected: this.isConnected,
            account: this.account,
            network: this.network
        };
    }

    // PERFORMANT: Clear cache
    clearCache(): void {
        this.connectionCache.clear();
    }

    // MODULAR: Switch network
    async switchNetwork(networkName: 'calibration' | 'mainnet'): Promise<void> {
        this.network = networkName;
        await this.ensureFilecoinNetwork();
    }

    // CLEAN: Get current account safely
    getCurrentAccount(): string | null {
        return this.account;
    }

    // MODULAR: Check if on correct network
    async isOnFilecoinNetwork(): Promise<boolean> {
        const networkInfo = await this.getNetworkInfo();
        return networkInfo.isFilecoin;
    }
}

// MODULAR: Export singleton instance
export const walletManager = new WalletManager();

// DRY: Export class and types
export { WalletManager };
export type { WalletConnection, NetworkInfo, BalanceInfo, FilecoinNetwork };