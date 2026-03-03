/**
 * Wallet Connector Module
 * Multi-chain wallet integration: MetaMask, WalletConnect, Coinbase Wallet
 * Supports Ethereum, Polygon, BSC, Solana
 */

class WalletConnector {
    constructor() {
        this.connectedWallet = null;
        this.walletAddress = null;
        this.walletType = null;
        this.chainId = null;
        this.provider = null;
        
        this.chains = {
            ethereum: {
                chainId: '0x1',
                chainName: 'Ethereum Mainnet',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://mainnet.infura.io/v3/YOUR_INFURA_KEY'],
                blockExplorerUrls: ['https://etherscan.io']
            },
            polygon: {
                chainId: '0x89',
                chainName: 'Polygon Mainnet',
                nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
                rpcUrls: ['https://polygon-rpc.com'],
                blockExplorerUrls: ['https://polygonscan.com']
            },
            bsc: {
                chainId: '0x38',
                chainName: 'Binance Smart Chain',
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                rpcUrls: ['https://bsc-dataseed.binance.org'],
                blockExplorerUrls: ['https://bscscan.com']
            },
            solana: {
                chainName: 'Solana Mainnet',
                nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
                rpcUrls: ['https://api.mainnet-beta.solana.com']
            }
        };
        
        this.init();
    }

    /**
     * Initialize wallet connector
     */
    init() {
        this.checkMetaMaskInstalled();
        this.setupEventListeners();
        this.loadSavedWallet();
    }

    /**
     * Check if MetaMask is installed
     */
    checkMetaMaskInstalled() {
        if (typeof window.ethereum !== 'undefined') {
            console.log('MetaMask is installed!');
            return true;
        }
        return false;
    }

    /**
     * Connect to MetaMask
     */
    async connectMetaMask() {
        try {
            if (!this.checkMetaMaskInstalled()) {
                throw new Error('MetaMask is not installed. Please install it to continue.');
            }

            // Request account access
            const accounts = await window.ethereum.request({ 
                method: 'eth_requestAccounts' 
            });
            
            this.walletAddress = accounts[0];
            this.walletType = 'MetaMask';
            this.provider = window.ethereum;
            
            // Get chain ID
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            this.chainId = chainId;
            
            this.connectedWallet = {
                address: this.walletAddress,
                type: this.walletType,
                chainId: this.chainId
            };
            
            this.saveWalletConnection();
            this.setupMetaMaskListeners();
            
            return this.connectedWallet;
        } catch (error) {
            console.error('MetaMask connection error:', error);
            throw error;
        }
    }

    /**
     * Setup MetaMask event listeners
     */
    setupMetaMaskListeners() {
        if (window.ethereum) {
            // Account changed
            window.ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    this.disconnectWallet();
                } else {
                    this.walletAddress = accounts[0];
                    this.updateWalletDisplay();
                }
            });

            // Chain changed
            window.ethereum.on('chainChanged', (chainId) => {
                this.chainId = chainId;
                this.updateWalletDisplay();
                window.location.reload(); // Reload to update UI
            });
        }
    }

    /**
     * Connect to WalletConnect
     */
    async connectWalletConnect() {
        try {
            // WalletConnect integration would require @walletconnect/web3-provider
            // This is a placeholder for the actual implementation
            
            console.log('WalletConnect integration: In production, use @walletconnect/web3-provider');
            
            // Simulated connection for demo
            return {
                address: '0x' + '0'.repeat(40),
                type: 'WalletConnect',
                chainId: '0x1'
            };
        } catch (error) {
            console.error('WalletConnect connection error:', error);
            throw error;
        }
    }

    /**
     * Connect to Coinbase Wallet
     */
    async connectCoinbaseWallet() {
        try {
            // Coinbase Wallet integration would require @coinbase/wallet-sdk
            // This is a placeholder for the actual implementation
            
            console.log('Coinbase Wallet integration: In production, use @coinbase/wallet-sdk');
            
            // Simulated connection for demo
            return {
                address: '0x' + '0'.repeat(40),
                type: 'Coinbase Wallet',
                chainId: '0x1'
            };
        } catch (error) {
            console.error('Coinbase Wallet connection error:', error);
            throw error;
        }
    }

    /**
     * Get wallet balance
     */
    async getBalance(address = null) {
        const addr = address || this.walletAddress;
        
        if (!addr || !this.provider) {
            return '0';
        }

        try {
            const balance = await this.provider.request({
                method: 'eth_getBalance',
                params: [addr, 'latest']
            });
            
            // Convert from Wei to Ether
            return (parseInt(balance, 16) / 1e18).toFixed(4);
        } catch (error) {
            console.error('Error getting balance:', error);
            return '0';
        }
    }

    /**
     * Get token balance (ERC-20)
     */
    async getTokenBalance(tokenAddress, decimals = 18) {
        if (!this.walletAddress || !this.provider) {
            return '0';
        }

        try {
            // ERC-20 balanceOf function signature
            const data = '0x70a08231' + this.walletAddress.slice(2).padStart(64, '0');
            
            const balance = await this.provider.request({
                method: 'eth_call',
                params: [{
                    to: tokenAddress,
                    data: data
                }, 'latest']
            });
            
            return (parseInt(balance, 16) / Math.pow(10, decimals)).toFixed(2);
        } catch (error) {
            console.error('Error getting token balance:', error);
            return '0';
        }
    }

    /**
     * Get multi-chain balances
     */
    async getMultiChainBalances() {
        const balances = {
            ethereum: { native: '0', usdc: '0', usdt: '0', dai: '0' },
            polygon: { native: '0', usdc: '0', usdt: '0', dai: '0' },
            bsc: { native: '0', usdc: '0', usdt: '0', dai: '0' },
            solana: { native: '0', usdc: '0' }
        };

        if (!this.walletAddress) {
            return balances;
        }

        // Token addresses (mainnet examples)
        const tokens = {
            ethereum: {
                usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                dai: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
            },
            polygon: {
                usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                usdt: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
                dai: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063'
            },
            bsc: {
                usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
                usdt: '0x55d398326f99059fF775485246999027B3197955',
                dai: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'
            }
        };

        try {
            // Get native balance
            balances.ethereum.native = await this.getBalance();
            
            // Get token balances for Ethereum
            balances.ethereum.usdc = await this.getTokenBalance(tokens.ethereum.usdc, 6);
            balances.ethereum.usdt = await this.getTokenBalance(tokens.ethereum.usdt, 6);
            balances.ethereum.dai = await this.getTokenBalance(tokens.ethereum.dai, 18);
            
        } catch (error) {
            console.error('Error getting multi-chain balances:', error);
        }

        return balances;
    }

    /**
     * Switch to different chain
     */
    async switchChain(chainName) {
        if (!this.provider) {
            throw new Error('No wallet connected');
        }

        const chain = this.chains[chainName];
        if (!chain) {
            throw new Error('Chain not supported');
        }

        try {
            await this.provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: chain.chainId }]
            });
            
            this.chainId = chain.chainId;
            return true;
        } catch (error) {
            // Chain not added to wallet
            if (error.code === 4902) {
                try {
                    await this.provider.request({
                        method: 'wallet_addEthereumChain',
                        params: [chain]
                    });
                    return true;
                } catch (addError) {
                    throw addError;
                }
            }
            throw error;
        }
    }

    /**
     * Get current chain info
     */
    getChainInfo() {
        for (const [name, chain] of Object.entries(this.chains)) {
            if (chain.chainId === this.chainId) {
                return { name, ...chain };
            }
        }
        return { name: 'Unknown', chainName: 'Unknown Network' };
    }

    /**
     * Sign message
     */
    async signMessage(message) {
        if (!this.walletAddress || !this.provider) {
            throw new Error('No wallet connected');
        }

        try {
            const signature = await this.provider.request({
                method: 'personal_sign',
                params: [message, this.walletAddress]
            });
            
            return signature;
        } catch (error) {
            console.error('Error signing message:', error);
            throw error;
        }
    }

    /**
     * Send transaction
     */
    async sendTransaction(to, value, data = '0x') {
        if (!this.walletAddress || !this.provider) {
            throw new Error('No wallet connected');
        }

        try {
            const transactionParameters = {
                from: this.walletAddress,
                to: to,
                value: '0x' + parseInt(value * 1e18).toString(16),
                data: data
            };

            const txHash = await this.provider.request({
                method: 'eth_sendTransaction',
                params: [transactionParameters]
            });

            return txHash;
        } catch (error) {
            console.error('Transaction error:', error);
            throw error;
        }
    }

    /**
     * Get gas price
     */
    async getGasPrice() {
        if (!this.provider) {
            return '0';
        }

        try {
            const gasPrice = await this.provider.request({
                method: 'eth_gasPrice'
            });
            
            // Convert to Gwei
            return (parseInt(gasPrice, 16) / 1e9).toFixed(2);
        } catch (error) {
            console.error('Error getting gas price:', error);
            return '0';
        }
    }

    /**
     * Estimate gas
     */
    async estimateGas(to, value, data = '0x') {
        if (!this.walletAddress || !this.provider) {
            return '0';
        }

        try {
            const gas = await this.provider.request({
                method: 'eth_estimateGas',
                params: [{
                    from: this.walletAddress,
                    to: to,
                    value: '0x' + parseInt(value * 1e18).toString(16),
                    data: data
                }]
            });
            
            return parseInt(gas, 16).toString();
        } catch (error) {
            console.error('Error estimating gas:', error);
            return '21000'; // Default gas limit for simple transfer
        }
    }

    /**
     * Disconnect wallet
     */
    disconnectWallet() {
        this.connectedWallet = null;
        this.walletAddress = null;
        this.walletType = null;
        this.chainId = null;
        this.provider = null;
        
        localStorage.removeItem('connectedWallet');
        this.updateWalletDisplay();
    }

    /**
     * Save wallet connection to localStorage
     */
    saveWalletConnection() {
        if (this.connectedWallet) {
            localStorage.setItem('connectedWallet', JSON.stringify(this.connectedWallet));
        }
    }

    /**
     * Load saved wallet connection
     */
    async loadSavedWallet() {
        const saved = localStorage.getItem('connectedWallet');
        if (saved) {
            const wallet = JSON.parse(saved);
            if (wallet.type === 'MetaMask' && this.checkMetaMaskInstalled()) {
                try {
                    await this.connectMetaMask();
                } catch (error) {
                    console.log('Could not reconnect to saved wallet');
                }
            }
        }
    }

    /**
     * Update wallet display in UI
     */
    updateWalletDisplay() {
        if (this.connectedWallet) {
            const indicator = document.getElementById('connection-indicator');
            const addressEl = document.getElementById('wallet-address');
            const networkEl = document.getElementById('wallet-network');
            const typeEl = document.getElementById('wallet-type');

            if (indicator) {
                indicator.textContent = '🟢 Connected';
                indicator.className = 'connected';
            }

            if (addressEl) {
                addressEl.textContent = this.formatAddress(this.walletAddress);
            }

            if (networkEl) {
                const chainInfo = this.getChainInfo();
                networkEl.textContent = chainInfo.chainName;
            }

            if (typeEl) {
                typeEl.textContent = this.walletType;
            }
        } else {
            const indicator = document.getElementById('connection-indicator');
            if (indicator) {
                indicator.textContent = '⚪ Not Connected';
                indicator.className = 'disconnected';
            }
        }
    }

    /**
     * Format address for display
     */
    formatAddress(address) {
        if (!address) return 'Not connected';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // This will be called from the main controller
    }

    /**
     * Get wallet info
     */
    getWalletInfo() {
        return {
            address: this.walletAddress,
            type: this.walletType,
            chainId: this.chainId,
            chain: this.getChainInfo()
        };
    }

    /**
     * Check if wallet is connected
     */
    isConnected() {
        return this.connectedWallet !== null && this.walletAddress !== null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletConnector;
}
