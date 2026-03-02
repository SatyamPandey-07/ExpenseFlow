const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const treasuryRepository = require('../repositories/treasuryRepository');
const rebalancingEngine = require('../services/rebalancingEngine');
const ResponseFactory = require('../utils/responseFactory');

/**
 * Treasury Management Routes
 * Issue #768: API for real-time liquidity visualization.
 */

/**
 * @route   GET /api/treasury/status
 * @desc    Get all virtual liquidity nodes for the current workspace
 */
router.get('/status', auth, async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'] || req.user.activeWorkspace;
        const nodes = await treasuryRepository.findByWorkspace(workspaceId);

        return ResponseFactory.success(res, nodes);
    } catch (error) {
        return ResponseFactory.error(res, 500, error.message);
    }
});

/**
 * @route   POST /api/treasury/rebalance
 * @desc    Manually trigger rebalancing algorithm for current workspace
 */
router.post('/rebalance', auth, async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'] || req.user.activeWorkspace;
        await rebalancingEngine.rebalanceWorkspace(workspaceId);

        return ResponseFactory.success(res, { message: 'Rebalancing initiated successfully' });
    } catch (error) {
        return ResponseFactory.error(res, 500, error.message);
    }
});

/**
 * @route   POST /api/treasury/nodes/init
 * @desc    Initialize treasury nodes for a new tenant
 */
router.post('/nodes/init', auth, async (req, res) => {
    try {
        const workspaceId = req.headers['x-workspace-id'] || req.user.activeWorkspace;

        const nodes = [
            { workspaceId, nodeType: 'OPERATING', balance: 5000 },
            { workspaceId, nodeType: 'RESERVE', balance: 10000 },
            { workspaceId, nodeType: 'TAX', balance: 2000 }
        ];

        for (const nodeData of nodes) {
            const existing = await treasuryRepository.findNode(workspaceId, nodeData.nodeType);
            if (!existing) {
                await treasuryRepository.create(nodeData);
            }
        }

        return ResponseFactory.success(res, { message: 'Treasury nodes initialized' });
    } catch (error) {
        return ResponseFactory.error(res, 500, error.message);
    }
});

module.exports = router;
