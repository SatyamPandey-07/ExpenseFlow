/**
 * Smart Contract Escrow System
 * Manages secure vendor payment escrows with arbiter support
 * Handles deposit, release, refund, and dispute resolution
 */

class SmartContractEscrow {
    constructor(walletConnector) {
        this.walletConnector = walletConnector;
        this.escrows = [];
        
        // Escrow contract ABI (simplified)
        this.escrowABI = [
            {
                "inputs": [
                    {"name": "_vendor", "type": "address"},
                    {"name": "_arbiter", "type": "address"},
                    {"name": "_amount", "type": "uint256"}
                ],
                "name": "createEscrow",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "payable",
                "type": "function"
            },
            {
                "inputs": [{"name": "_escrowId", "type": "uint256"}],
                "name": "releasePayment",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "_escrowId", "type": "uint256"}],
                "name": "refundPayment",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [{"name": "_escrowId", "type": "uint256"}],
                "name": "getEscrowDetails",
                "outputs": [
                    {"name": "buyer", "type": "address"},
                    {"name": "vendor", "type": "address"},
                    {"name": "arbiter", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                    {"name": "status", "type": "uint8"}
                ],
                "stateMutability": "view",
                "type": "function"
            }
        ];
        
        // Escrow contract addresses by chain
        this.contractAddresses = {
            '0x1': '0x0000000000000000000000000000000000000001', // Ethereum
            '0x89': '0x0000000000000000000000000000000000000002', // Polygon
            '0x38': '0x0000000000000000000000000000000000000003' // BSC
        };
        
        this.escrowStatuses = {
            0: 'Created',
            1: 'Funded',
            2: 'Released',
            3: 'Refunded',
            4: 'Disputed'
        };
        
        this.loadEscrows();
    }

    /**
     * Create new escrow
     */
    async createEscrow(config) {
        const {
            vendor,
            amount,
            arbiter,
            description,
            dueDate,
            currency = 'ETH',
            autoRelease = false,
            releaseConditions = []
        } = config;

        if (!this.walletConnector.isConnected()) {
            throw new Error('Wallet not connected');
        }

        try {
            // Generate unique escrow ID
            const escrowId = this.generateEscrowId();
            
            // Create escrow data
            const escrow = {
                id: escrowId,
                buyer: this.walletConnector.walletAddress,
                vendor: vendor,
                arbiter: arbiter,
                amount: parseFloat(amount),
                currency: currency,
                description: description,
                dueDate: dueDate,
                createdAt: new Date().toISOString(),
                status: 'Created',
                autoRelease: autoRelease,
                releaseConditions: releaseConditions,
                txHash: null,
                contractAddress: this.getContractAddress(),
                events: [{
                    type: 'Created',
                    timestamp: new Date().toISOString(),
                    by: this.walletConnector.walletAddress
                }]
            };

            // Encode function call
            const data = this.encodeCreateEscrow(vendor, arbiter, amount);
            
            // Send transaction
            const txHash = await this.walletConnector.sendTransaction(
                this.getContractAddress(),
                amount,
                data
            );
            
            escrow.txHash = txHash;
            escrow.status = 'Funded';
            escrow.events.push({
                type: 'Funded',
                timestamp: new Date().toISOString(),
                by: this.walletConnector.walletAddress,
                txHash: txHash
            });

            this.escrows.push(escrow);
            this.saveEscrows();
            
            return escrow;
        } catch (error) {
            console.error('Error creating escrow:', error);
            throw error;
        }
    }

    /**
     * Release payment to vendor
     */
    async releasePayment(escrowId) {
        const escrow = this.getEscrow(escrowId);
        
        if (!escrow) {
            throw new Error('Escrow not found');
        }

        if (escrow.status !== 'Funded') {
            throw new Error('Escrow is not in funded state');
        }

        if (escrow.buyer !== this.walletConnector.walletAddress) {
            throw new Error('Only buyer can release payment');
        }

        try {
            // Encode release function call
            const data = this.encodeReleasePayment(escrowId);
            
            // Send transaction
            const txHash = await this.walletConnector.sendTransaction(
                escrow.contractAddress,
                0,
                data
            );

            escrow.status = 'Released';
            escrow.releasedAt = new Date().toISOString();
            escrow.events.push({
                type: 'Released',
                timestamp: new Date().toISOString(),
                by: this.walletConnector.walletAddress,
                txHash: txHash
            });

            this.saveEscrows();
            
            return { success: true, txHash, escrow };
        } catch (error) {
            console.error('Error releasing payment:', error);
            throw error;
        }
    }

    /**
     * Request refund
     */
    async requestRefund(escrowId, reason) {
        const escrow = this.getEscrow(escrowId);
        
        if (!escrow) {
            throw new Error('Escrow not found');
        }

        if (escrow.status !== 'Funded') {
            throw new Error('Escrow is not in funded state');
        }

        try {
            // Encode refund function call
            const data = this.encodeRefundPayment(escrowId);
            
            // Send transaction
            const txHash = await this.walletConnector.sendTransaction(
                escrow.contractAddress,
                0,
                data
            );

            escrow.status = 'Refunded';
            escrow.refundedAt = new Date().toISOString();
            escrow.refundReason = reason;
            escrow.events.push({
                type: 'Refunded',
                timestamp: new Date().toISOString(),
                by: this.walletConnector.walletAddress,
                reason: reason,
                txHash: txHash
            });

            this.saveEscrows();
            
            return { success: true, txHash, escrow };
        } catch (error) {
            console.error('Error requesting refund:', error);
            throw error;
        }
    }

    /**
     * Raise dispute
     */
    raiseDispute(escrowId, reason, evidence = []) {
        const escrow = this.getEscrow(escrowId);
        
        if (!escrow) {
            throw new Error('Escrow not found');
        }

        if (!['Funded', 'Released'].includes(escrow.status)) {
            throw new Error('Cannot raise dispute for this escrow');
        }

        escrow.status = 'Disputed';
        escrow.dispute = {
            raisedBy: this.walletConnector.walletAddress,
            raisedAt: new Date().toISOString(),
            reason: reason,
            evidence: evidence,
            resolution: null
        };
        escrow.events.push({
            type: 'Disputed',
            timestamp: new Date().toISOString(),
            by: this.walletConnector.walletAddress,
            reason: reason
        });

        this.saveEscrows();
        
        return escrow;
    }

    /**
     * Resolve dispute (arbiter only)
     */
    async resolveDispute(escrowId, resolution, favorOf) {
        const escrow = this.getEscrow(escrowId);
        
        if (!escrow) {
            throw new Error('Escrow not found');
        }

        if (escrow.status !== 'Disputed') {
            throw new Error('Escrow is not in disputed state');
        }

        if (escrow.arbiter !== this.walletConnector.walletAddress) {
            throw new Error('Only arbiter can resolve dispute');
        }

        try {
            let txHash;
            
            if (favorOf === 'vendor') {
                // Release to vendor
                const data = this.encodeReleasePayment(escrowId);
                txHash = await this.walletConnector.sendTransaction(
                    escrow.contractAddress,
                    0,
                    data
                );
                escrow.status = 'Released';
            } else {
                // Refund to buyer
                const data = this.encodeRefundPayment(escrowId);
                txHash = await this.walletConnector.sendTransaction(
                    escrow.contractAddress,
                    0,
                    data
                );
                escrow.status = 'Refunded';
            }

            escrow.dispute.resolution = {
                resolvedBy: this.walletConnector.walletAddress,
                resolvedAt: new Date().toISOString(),
                decision: resolution,
                favorOf: favorOf,
                txHash: txHash
            };
            
            escrow.events.push({
                type: 'DisputeResolved',
                timestamp: new Date().toISOString(),
                by: this.walletConnector.walletAddress,
                decision: resolution,
                favorOf: favorOf,
                txHash: txHash
            });

            this.saveEscrows();
            
            return { success: true, txHash, escrow };
        } catch (error) {
            console.error('Error resolving dispute:', error);
            throw error;
        }
    }

    /**
     * Check auto-release conditions
     */
    checkAutoRelease(escrowId) {
        const escrow = this.getEscrow(escrowId);
        
        if (!escrow || !escrow.autoRelease) {
            return false;
        }

        if (escrow.status !== 'Funded') {
            return false;
        }

        // Check due date
        if (escrow.dueDate && new Date(escrow.dueDate) < new Date()) {
            return true;
        }

        // Check custom conditions
        if (escrow.releaseConditions && escrow.releaseConditions.length > 0) {
            const allMet = escrow.releaseConditions.every(condition => {
                return this.checkCondition(condition, escrow);
            });
            
            if (allMet) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check release condition
     */
    checkCondition(condition, escrow) {
        switch (condition.type) {
            case 'time':
                return new Date(condition.value) < new Date();
            case 'confirmation':
                return escrow.confirmations && escrow.confirmations >= condition.value;
            case 'oracle':
                // Would integrate with external oracle
                return false;
            default:
                return false;
        }
    }

    /**
     * Get escrow details
     */
    getEscrow(escrowId) {
        return this.escrows.find(e => e.id === escrowId);
    }

    /**
     * Get all escrows
     */
    getAllEscrows() {
        return this.escrows;
    }

    /**
     * Get escrows by status
     */
    getEscrowsByStatus(status) {
        return this.escrows.filter(e => e.status === status);
    }

    /**
     * Get active escrows (buyer perspective)
     */
    getMyActiveEscrows() {
        const myAddress = this.walletConnector.walletAddress;
        return this.escrows.filter(e => 
            e.buyer === myAddress && ['Created', 'Funded', 'Disputed'].includes(e.status)
        );
    }

    /**
     * Get vendor escrows (vendor perspective)
     */
    getVendorEscrows() {
        const myAddress = this.walletConnector.walletAddress;
        return this.escrows.filter(e => e.vendor === myAddress);
    }

    /**
     * Get arbiter escrows (arbiter perspective)
     */
    getArbiterEscrows() {
        const myAddress = this.walletConnector.walletAddress;
        return this.escrows.filter(e => 
            e.arbiter === myAddress && e.status === 'Disputed'
        );
    }

    /**
     * Calculate escrow statistics
     */
    getEscrowStats() {
        const myAddress = this.walletConnector.walletAddress;
        const myEscrows = this.escrows.filter(e => e.buyer === myAddress);
        
        return {
            total: myEscrows.length,
            active: myEscrows.filter(e => ['Created', 'Funded'].includes(e.status)).length,
            completed: myEscrows.filter(e => e.status === 'Released').length,
            refunded: myEscrows.filter(e => e.status === 'Refunded').length,
            disputed: myEscrows.filter(e => e.status === 'Disputed').length,
            totalAmount: myEscrows.reduce((sum, e) => sum + e.amount, 0),
            lockedAmount: myEscrows
                .filter(e => e.status === 'Funded')
                .reduce((sum, e) => sum + e.amount, 0)
        };
    }

    /**
     * Encode createEscrow function call
     */
    encodeCreateEscrow(vendor, arbiter, amount) {
        // Function selector for createEscrow(address,address,uint256)
        const functionSelector = '0x12345678'; // Would be calculated from keccak256
        
        // Encode parameters
        const encodedVendor = vendor.slice(2).padStart(64, '0');
        const encodedArbiter = arbiter.slice(2).padStart(64, '0');
        const encodedAmount = parseInt(amount * 1e18).toString(16).padStart(64, '0');
        
        return functionSelector + encodedVendor + encodedArbiter + encodedAmount;
    }

    /**
     * Encode releasePayment function call
     */
    encodeReleasePayment(escrowId) {
        const functionSelector = '0x87654321'; // Would be calculated from keccak256
        const encodedId = escrowId.toString(16).padStart(64, '0');
        return functionSelector + encodedId;
    }

    /**
     * Encode refundPayment function call
     */
    encodeRefundPayment(escrowId) {
        const functionSelector = '0x11111111'; // Would be calculated from keccak256
        const encodedId = escrowId.toString(16).padStart(64, '0');
        return functionSelector + encodedId;
    }

    /**
     * Get contract address for current chain
     */
    getContractAddress() {
        const chainId = this.walletConnector.chainId;
        return this.contractAddresses[chainId] || this.contractAddresses['0x1'];
    }

    /**
     * Generate unique escrow ID
     */
    generateEscrowId() {
        return Date.now() + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Load escrows from localStorage
     */
    loadEscrows() {
        const saved = localStorage.getItem('blockchainEscrows');
        if (saved) {
            this.escrows = JSON.parse(saved);
        }
    }

    /**
     * Save escrows to localStorage
     */
    saveEscrows() {
        localStorage.setItem('blockchainEscrows', JSON.stringify(this.escrows));
    }

    /**
     * Export escrow data
     */
    exportEscrow(escrowId) {
        const escrow = this.getEscrow(escrowId);
        if (!escrow) {
            throw new Error('Escrow not found');
        }

        return {
            escrow: escrow,
            exportedAt: new Date().toISOString(),
            exportedBy: this.walletConnector.walletAddress
        };
    }

    /**
     * Clear all escrows (for testing)
     */
    clearEscrows() {
        this.escrows = [];
        this.saveEscrows();
    }
}

// Solidity contract example (for reference)
const ESCROW_SOLIDITY_CONTRACT = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ExpenseEscrow {
    enum Status { Created, Funded, Released, Refunded, Disputed }
    
    struct Escrow {
        address buyer;
        address vendor;
        address arbiter;
        uint256 amount;
        Status status;
        uint256 createdAt;
    }
    
    mapping(uint256 => Escrow) public escrows;
    uint256 public escrowCount;
    
    event EscrowCreated(uint256 indexed escrowId, address buyer, address vendor, uint256 amount);
    event PaymentReleased(uint256 indexed escrowId);
    event PaymentRefunded(uint256 indexed escrowId);
    
    function createEscrow(address _vendor, address _arbiter) external payable returns (uint256) {
        require(msg.value > 0, "Must send ETH");
        require(_vendor != address(0), "Invalid vendor");
        require(_arbiter != address(0), "Invalid arbiter");
        
        escrowCount++;
        escrows[escrowCount] = Escrow({
            buyer: msg.sender,
            vendor: _vendor,
            arbiter: _arbiter,
            amount: msg.value,
            status: Status.Funded,
            createdAt: block.timestamp
        });
        
        emit EscrowCreated(escrowCount, msg.sender, _vendor, msg.value);
        return escrowCount;
    }
    
    function releasePayment(uint256 _escrowId) external {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Funded, "Invalid status");
        require(msg.sender == escrow.buyer || msg.sender == escrow.arbiter, "Not authorized");
        
        escrow.status = Status.Released;
        payable(escrow.vendor).transfer(escrow.amount);
        
        emit PaymentReleased(_escrowId);
    }
    
    function refundPayment(uint256 _escrowId) external {
        Escrow storage escrow = escrows[_escrowId];
        require(escrow.status == Status.Funded, "Invalid status");
        require(msg.sender == escrow.vendor || msg.sender == escrow.arbiter, "Not authorized");
        
        escrow.status = Status.Refunded;
        payable(escrow.buyer).transfer(escrow.amount);
        
        emit PaymentRefunded(_escrowId);
    }
}
`;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SmartContractEscrow;
}
