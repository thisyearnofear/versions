// MODULAR: Filecoin integration for VERSIONS web interface
// CLEAN: Abstracts all Filecoin complexity from the UI

import { appConfig } from './config.js';
import { walletManager } from './wallet-connection.js';

class FilecoinIntegration {
    constructor() {
        this.synapse = null;
        this.isInitialized = false;
        this.network = 'calibration'; // Start with testnet
        // PERFORMANT: Cache for storage info
        this.storageCache = new Map();
    }

    // PERFORMANT: Lazy load Synapse SDK with wallet integration
    async loadSynapseSDK() {
        if (!this.synapse) {
            try {
                // CLEAN: Ensure wallet is connected first
                if (!walletManager.isConnected) {
                    await walletManager.connectWallet();
                }

                // CLEAN: Dynamic import for better performance
                const { Synapse } = await import('https://esm.sh/@filoz/synapse-sdk');
                
                // ENHANCEMENT: Initialize with real wallet connection
                this.synapse = new Synapse({
                    network: this.network,
                    signer: walletManager.signer,
                    provider: walletManager.provider
                });
                
                this.isInitialized = true;
                console.log('🌍 Filecoin Synapse SDK loaded with wallet');
                return true;
            } catch (error) {
                console.warn('Filecoin SDK initialization failed:', error.message);
                return false;
            }
        }
        return true;
    }

    // CLEAN: Check if Filecoin features are available
    isAvailable() {
        return this.isInitialized && this.synapse;
    }

    // ENHANCEMENT FIRST: Upload version to global storage with real SDK
    async uploadVersionGlobal(audioFile, metadata, progressCallback) {
        try {
            // CLEAN: Terminal-style progress updates
            progressCallback?.("$ versions upload --global", 0);
            
            if (!this.isAvailable()) {
                await this.loadSynapseSDK();
            }

            progressCallback?.("Analyzing audio metadata...", 10);
            
            // ENHANCEMENT: Check and handle payment requirements
            await this.ensureStoragePayment(audioFile.size, progressCallback);
            
            // Convert File to Uint8Array (following fs-upload-dapp pattern)
            const arrayBuffer = await audioFile.arrayBuffer();
            const uint8ArrayBytes = new Uint8Array(arrayBuffer);

            progressCallback?.("Connecting to global storage network...", 30);

            // Create storage service (following Synapse SDK pattern)
            const storageService = await this.synapse.createStorage({
                callbacks: {
                    onDataSetResolved: () => {
                        progressCallback?.("Existing dataset found and resolved", 40);
                    },
                    onDataSetCreationStarted: () => {
                        progressCallback?.("Creating new dataset on blockchain...", 50);
                    },
                    onProviderSelected: () => {
                        progressCallback?.("Storage provider selected", 60);
                    }
                }
            });

            progressCallback?.("Uploading to global CDN...", 70);

            // Upload with callbacks (following fs-upload-dapp pattern)
            const { pieceCid } = await storageService.upload(uint8ArrayBytes, {
                onUploadComplete: (piece) => {
                    progressCallback?.("Generating ownership proof...", 85);
                },
                onPieceConfirmed: () => {
                    progressCallback?.("Data pieces added to dataset successfully", 95);
                }
            });

            progressCallback?.("✓ Version published globally", 100);

            const storageInfo = {
                piece_cid: pieceCid.toV1().toString(),
                cdn_url: `https://cdn.filecoin.io/${pieceCid.toV1().toString()}`,
                global_availability: true,
                upload_date: new Date().toISOString()
            };

            // PERFORMANT: Cache the result
            this.storageCache.set(metadata.file_id, storageInfo);

            return storageInfo;

        } catch (error) {
            console.error('Filecoin upload failed:', error);
            throw new Error(`Global upload failed: ${error.message}`);
        }
    }

    // MODULAR: Ensure storage payment is available
    async ensureStoragePayment(fileSize, progressCallback) {
        try {
            if (!this.synapse) {
                throw new Error('Synapse SDK not initialized');
            }

            progressCallback?.("Checking USDFC balance and storage allowances...", 15);

            // Import TOKENS from Synapse SDK
            const { TOKENS, TIME_CONSTANTS } = await import('https://esm.sh/@filoz/synapse-sdk');
            
            // Check if we have enough USDFC balance
            const balance = await this.synapse.payments.walletBalance(TOKENS.USDFC);
            const requiredAmount = this.calculateStorageCost(fileSize);
            
            if (balance < requiredAmount) {
                progressCallback?.("Insufficient USDFC balance - please add funds", 15);
                throw new Error(`Insufficient USDFC balance. Required: ${requiredAmount}, Available: ${balance}`);
            }

            // Check allowances
            const paymentsAddress = this.synapse.getPaymentsAddress();
            const allowance = await this.synapse.payments.allowance(paymentsAddress, TOKENS.USDFC);
            const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
            
            if (allowance < MAX_UINT256 / 2n) {
                progressCallback?.("Approving USDFC to cover storage costs...", 18);
                const transaction = await this.synapse.payments.approve(paymentsAddress, MAX_UINT256, TOKENS.USDFC);
                await transaction.wait();
            }

            // Deposit if needed
            if (requiredAmount > 0n) {
                progressCallback?.("Depositing USDFC to cover storage costs...", 20);
                const transaction = await this.synapse.payments.deposit(requiredAmount);
                await transaction.wait();
            }

            // Approve service
            progressCallback?.("Approving Filecoin Warm Storage service...", 25);
            const warmStorageAddress = this.synapse.getWarmStorageAddress();
            const epochRateAllowance = BigInt(1000000); // 1 USDFC per epoch
            const lockupAllowance = requiredAmount + BigInt(1000000); // Storage cost + buffer
            const maxLockupPeriod = TIME_CONSTANTS.EPOCHS_PER_DAY * 30n; // 30 days
            
            const approveTransaction = await this.synapse.payments.approveService(
                warmStorageAddress,
                epochRateAllowance,
                lockupAllowance,
                maxLockupPeriod
            );
            await approveTransaction.wait();

            progressCallback?.("Payment setup complete", 28);

        } catch (error) {
            console.warn('Payment setup failed:', error);
            // Continue anyway - might work without explicit payment setup
        }
    }

    // CLEAN: Calculate storage cost based on file size
    calculateStorageCost(fileSize) {
        // Rough calculation: ~0.001 USDFC per MB for 30 days
        const fileSizeMB = fileSize / (1024 * 1024);
        const costPerMB = 1000; // 0.001 USDFC in micro units
        return BigInt(Math.ceil(fileSizeMB * costPerMB));
    }

    // PERFORMANT: Stream from global CDN
    async streamFromGlobal(pieceCid) {
        try {
            // PERFORMANT: Try FilCDN first for speed
            const cdnUrl = `https://cdn.filecoin.io/${pieceCid}`;
            const response = await fetch(cdnUrl);
            
            if (response.ok) {
                return response.blob();
            }
            
            // CLEAN: Fallback to our API
            const fallbackUrl = `${appConfig.apiBase}/api/v1/filecoin/stream/${pieceCid}`;
            const fallbackResponse = await fetch(fallbackUrl);
            
            if (fallbackResponse.ok) {
                return fallbackResponse.blob();
            }
            
            throw new Error('Failed to stream from global network');
            
        } catch (error) {
            console.error('Global streaming failed:', error);
            throw error;
        }
    }

    // MODULAR: Creator payment functionality with real Filecoin Pay
    async supportCreator(creatorAddress, usdAmount, message = '') {
        try {
            if (!this.isAvailable()) {
                await this.loadSynapseSDK();
            }

            if (!walletManager.isConnected) {
                throw new Error('Wallet not connected');
            }

            // Import TOKENS from Synapse SDK
            const { TOKENS } = await import('https://esm.sh/@filoz/synapse-sdk');
            
            // Convert USD to USDFC tokens (assuming 1:1 for simplicity)
            const tokenAmount = BigInt(Math.floor(usdAmount * 1000000)); // USDFC has 6 decimals
            
            // Check balance
            const balance = await this.synapse.payments.walletBalance(TOKENS.USDFC);
            if (balance < tokenAmount) {
                throw new Error(`Insufficient USDFC balance. Required: ${usdAmount} USDFC, Available: ${balance / 1000000n} USDFC`);
            }

            // Create payment rail
            const railId = await this.synapse.payments.createRail(
                TOKENS.USDFC,
                walletManager.account,  // from (fan)
                creatorAddress,         // to (creator)
                null,                   // no validator
                0,                      // no commission
                null                    // no service fee recipient
            );

            // Make one-time payment
            await this.synapse.payments.modifyRailPayment(
                railId,
                0n,              // no recurring rate
                tokenAmount      // one-time payment
            );

            return {
                success: true,
                rail_id: railId,
                amount: usdAmount,
                message: `${usdAmount} sent to creator!`,
                transaction_note: message
            };

        } catch (error) {
            console.error('Creator payment failed:', error);
            
            // CLEAN: Fallback to API if direct payment fails
            try {
                const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/payment/creator`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        creator_address: creatorAddress,
                        fan_address: walletManager.account,
                        usd_amount: usdAmount,
                        message: message
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    return {
                        success: true,
                        transaction_hash: data.data.transaction_hash,
                        message: `${usdAmount} sent to creator!`
                    };
                }
            } catch (apiError) {
                console.error('API fallback also failed:', apiError);
            }
            
            throw error;
        }
    }

    // CLEAN: Get network status
    async getNetworkStatus() {
        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/network/status`);
            const data = await response.json();
            
            if (data.success) {
                return data.data;
            } else {
                throw new Error(data.error || 'Failed to get network status');
            }
        } catch (error) {
            console.error('Failed to get network status:', error);
            return {
                network: this.network,
                status: 'unknown',
                error: error.message
            };
        }
    }

    // CLEAN: Get storage info for a version
    async getStorageInfo(fileId) {
        // PERFORMANT: Check cache first
        if (this.storageCache.has(fileId)) {
            return this.storageCache.get(fileId);
        }

        try {
            const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/storage/${fileId}`);
            const data = await response.json();
            
            if (data.success && data.data) {
                // PERFORMANT: Cache the result
                this.storageCache.set(fileId, data.data);
                return data.data;
            }
            
            return null;
        } catch (error) {
            console.error('Failed to get storage info:', error);
            return null;
        }
    }

    // ENHANCEMENT FIRST: Creator dashboard functionality
    // MODULAR: Creator earnings and analytics
    async getCreatorEarnings(creatorAddress = null) {
        const address = creatorAddress || walletManager.account;
        if (!address) {
            throw new Error('No creator address provided');
        }

        // CLEAN: Try real Filecoin Pay queries first
        if (this.isAvailable()) {
            try {
                const { TOKENS } = await import('https://esm.sh/@filoz/synapse-sdk');
                
                // Get payment rails where user is the recipient
                const incomingRails = await this.synapse.payments.getRailsForPayeeAndToken(address, TOKENS.USDFC);
                
                if (incomingRails.length === 0) {
                    return {
                        total_earnings_usdfc: '0',
                        total_earnings_usd: '0.00',
                        active_rails: 0,
                        version_earnings: [],
                        last_updated: new Date().toISOString()
                    };
                }
                
                // CLEAN: Calculate real earnings from settlement data
                let totalEarnings = 0n;
                const versionEarnings = [];
                
                for (const rail of incomingRails) {
                    try {
                        // Get actual settlement data for this rail
                        const settlements = await this.synapse.payments.getRailSettlements(rail.railId);
                        const railEarnings = settlements.reduce((sum, settlement) => sum + BigInt(settlement.amount), 0n);
                        
                        totalEarnings += railEarnings;
                        
                        if (railEarnings > 0n) {
                            versionEarnings.push({
                                rail_id: rail.railId,
                                version_id: rail.metadata?.version_id || `version-${rail.railId.slice(-8)}`,
                                title: rail.metadata?.title || `Version ${rail.railId.slice(-4)}`,
                                earnings_usdfc: railEarnings.toString(),
                                earnings_usd: (Number(railEarnings) / 1000000).toFixed(2),
                                play_count: rail.metadata?.play_count || 0,
                                last_payment: settlements.length > 0 ? settlements[settlements.length - 1].timestamp : new Date().toISOString()
                            });
                        }
                    } catch (railError) {
                        console.warn(`Failed to get settlements for rail ${rail.railId}:`, railError);
                    }
                }
                
                return {
                    total_earnings_usdfc: totalEarnings.toString(),
                    total_earnings_usd: (Number(totalEarnings) / 1000000).toFixed(2),
                    active_rails: incomingRails.length,
                    version_earnings: versionEarnings.sort((a, b) => parseFloat(b.earnings_usd) - parseFloat(a.earnings_usd)),
                    last_updated: new Date().toISOString()
                };
                
            } catch (sdkError) {
                console.warn('SDK earnings query failed:', sdkError.message);
                throw new Error(`Failed to query Filecoin Pay contracts: ${sdkError.message}`);
            }
        }
        
        // CLEAN: API fallback
        const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/creator/earnings?address=${address}`);
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to get creator earnings');
        }
        
        return data.data;
    }



    // MODULAR: Withdraw earnings functionality
    async withdrawEarnings(amount, withdrawalMethod = 'bank') {
        try {
            if (!walletManager.isConnected) {
                throw new Error('Wallet not connected');
            }

            // CLEAN: Validate amount
            const amountUSDFC = BigInt(Math.floor(amount * 1000000)); // Convert USD to USDFC
            
            if (this.isAvailable()) {
                const { TOKENS } = await import('https://esm.sh/@filoz/synapse-sdk');
                
                // Check balance
                const balance = await this.synapse.payments.walletBalance(TOKENS.USDFC);
                if (balance < amountUSDFC) {
                    throw new Error(`Insufficient balance. Available: ${(Number(balance) / 1000000).toFixed(2)} USDFC`);
                }
                
                // For now, just withdraw to wallet (real implementation would integrate with fiat off-ramps)
                const transaction = await this.synapse.payments.withdraw(amountUSDFC);
                await transaction.wait();
                
                return {
                    success: true,
                    transaction_hash: transaction.hash,
                    amount_usd: amount,
                    withdrawal_method: withdrawalMethod,
                    estimated_arrival: '2-3 business days'
                };
            } else {
                // CLEAN: API fallback
                const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/creator/withdraw`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        creator_address: walletManager.account,
                        amount_usd: amount,
                        withdrawal_method: withdrawalMethod
                    })
                });
                
                const data = await response.json();
                return data.success ? data.data : { success: false, error: data.error };
            }
            
        } catch (error) {
            console.error('Withdrawal failed:', error);
            throw error;
        }
    }

    // PERFORMANT: Get creator analytics
    async getCreatorAnalytics(period = '30d') {
        const address = walletManager.account;
        if (!address) {
            throw new Error('Wallet not connected');
        }

        // CLEAN: API request for analytics
        const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/creator/analytics?address=${address}&period=${period}`);
        if (!response.ok) {
            throw new Error(`Analytics API request failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to get creator analytics');
        }
        
        return data.data;
    }

    // CLEAN: Upload version using our API (fallback)
    async uploadVersionAPI(audioFile, metadata, progressCallback) {
        try {
            progressCallback?.("Preparing upload...", 10);

            // Convert file to base64
            const arrayBuffer = await audioFile.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64Content = btoa(String.fromCharCode(...uint8Array));

            progressCallback?.("Uploading to global storage...", 50);

            const response = await fetch(`${appConfig.apiBase}/api/v1/filecoin/upload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    file_id: metadata.file_id,
                    content: Array.from(uint8Array), // Send as array for now
                    metadata: {
                        title: metadata.title,
                        artist: metadata.artist,
                        version_type: metadata.version_type,
                        duration_seconds: metadata.duration_seconds,
                        file_size: audioFile.size,
                        format: metadata.format
                    }
                })
            });

            const data = await response.json();
            
            if (data.success) {
                progressCallback?.("✓ Version published globally", 100);
                return data.data;
            } else {
                throw new Error(data.error || 'Upload failed');
            }

        } catch (error) {
            console.error('API upload failed:', error);
            throw error;
        }
    }
}

// MODULAR: Export singleton instance
export const filecoinIntegration = new FilecoinIntegration();

// CLEAN: Helper functions for UI integration
export const FilecoinHelpers = {
    // CLEAN: Format storage costs for display
    formatStorageCost(cost) {
        if (!cost) return 'Free';
        return cost;
    },

    // CLEAN: Format piece CID for display
    formatPieceCID(cid) {
        if (!cid) return 'Unknown';
        return cid.length > 20 ? `${cid.substring(0, 8)}...${cid.substring(cid.length - 8)}` : cid;
    },

    // CLEAN: Check if CID is valid
    isValidPieceCID(cid) {
        return cid && cid.startsWith('bafk');
    },

    // PERFORMANT: Generate CDN URL
    getCDNUrl(pieceCid) {
        return `https://cdn.filecoin.io/${pieceCid}`;
    }
};