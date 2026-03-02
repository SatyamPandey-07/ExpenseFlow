/**
 * Investigation Case Manager
 * Manages fraud investigation cases, evidence collection, and case lifecycle
 */

class InvestigationManager {
    constructor() {
        this.cases = [];
        this.evidence = new Map();
        this.caseCounter = 0;
        this.loadData();
    }

    /**
     * Create investigation case
     */
    createCase(config) {
        const caseId = this.generateCaseId();
        
        const caseObj = {
            id: caseId,
            title: config.title,
            description: config.description,
            priority: config.priority || 'medium',
            status: 'open',
            severity: config.priority === 'high' ? 'critical' : 'medium',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            assignedTo: config.assignedTo || 'unassigned',
            expenseIds: config.expenseIds || [config.expenseId || null].filter(Boolean),
            alerts: config.alerts || [],
            evidence: [],
            notes: [],
            timeline: [{
                action: 'Case Created',
                timestamp: new Date().toISOString(),
                by: config.assignedTo || 'System'
            }],
            resolution: null,
            tags: config.tags || []
        };

        this.cases.push(caseObj);
        this.saveData();

        return caseObj;
    }

    /**
     * Get case by ID
     */
    getCase(caseId) {
        return this.cases.find(c => c.id === caseId);
    }

    /**
     * Update case
     */
    updateCase(caseId, updates) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return null;

        Object.assign(caseObj, updates, {
            updatedAt: new Date().toISOString()
        });

        if (updates.status) {
            caseObj.timeline.push({
                action: `Status changed to ${updates.status}`,
                timestamp: new Date().toISOString()
            });
        }

        this.saveData();
        return caseObj;
    }

    /**
     * Add evidence to case
     */
    addEvidence(caseId, evidence) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return null;

        const evidenceId = Date.now().toString();
        const evidenceObj = {
            id: evidenceId,
            type: evidence.type,
            description: evidence.description,
            source: evidence.source,
            data: evidence.data,
            addedAt: new Date().toISOString(),
            status: 'collected'
        };

        caseObj.evidence.push(evidenceId);
        this.evidence.set(evidenceId, evidenceObj);

        caseObj.timeline.push({
            action: `Evidence added: ${evidence.type}`,
            timestamp: new Date().toISOString()
        });

        this.saveData();
        return evidenceObj;
    }

    /**
     * Get case evidence
     */
    getCaseEvidence(caseId) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return [];

        return caseObj.evidence.map(eId => this.evidence.get(eId)).filter(Boolean);
    }

    /**
     * Add note to case
     */
    addNote(caseId, note) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return null;

        const noteObj = {
            id: Date.now().toString(),
            content: note,
            addedAt: new Date().toISOString(),
            addedBy: 'Investigator'
        };

        caseObj.notes.push(noteObj);

        caseObj.timeline.push({
            action: 'Note added',
            timestamp: new Date().toISOString()
        });

        this.saveData();
        return noteObj;
    }

    /**
     * Close case
     */
    closeCase(caseId, resolution) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return null;

        caseObj.status = 'closed';
        caseObj.resolution = {
            conclusion: resolution.conclusion,
            actionTaken: resolution.actionTaken,
            closedAt: new Date().toISOString(),
            closedBy: resolution.closedBy || 'Investigator'
        };

        caseObj.timeline.push({
            action: `Case closed: ${resolution.conclusion}`,
            timestamp: new Date().toISOString()
        });

        this.saveData();
        return caseObj;
    }

    /**
     * Get cases by status
     */
    getCasesByStatus(status) {
        return this.cases.filter(c => c.status === status);
    }

    /**
     * Get cases by priority
     */
    getCasesByPriority() {
        return {
            high: this.cases.filter(c => c.priority === 'high' && c.status === 'open'),
            medium: this.cases.filter(c => c.priority === 'medium' && c.status === 'open'),
            low: this.cases.filter(c => c.priority === 'low' && c.status === 'open')
        };
    }

    /**
     * Get cases assigned to investigator
     */
    getCasesForInvestigator(investigator) {
        return this.cases.filter(c => 
            c.assignedTo === investigator && c.status === 'open'
        );
    }

    /**
     * Generate case report
     */
    generateCaseReport(caseId) {
        const caseObj = this.getCase(caseId);
        if (!caseObj) return null;

        const evidence = this.getCaseEvidence(caseId);
        const timeline = caseObj.timeline;

        return {
            caseId: caseObj.id,
            title: caseObj.title,
            status: caseObj.status,
            priority: caseObj.priority,
            createdAt: caseObj.createdAt,
            updatedAt: caseObj.updatedAt,
            description: caseObj.description,
            assignedTo: caseObj.assignedTo,
            evidenceCount: evidence.length,
            notesCount: caseObj.notes.length,
            timelineEvents: timeline.length,
            resolution: caseObj.resolution,
            summary: {
                allertCount: caseObj.alerts.length,
                expenseCount: caseObj.expenseIds.length,
                daysActive: Math.floor(
                    (new Date() - new Date(caseObj.createdAt)) / (1000 * 60 * 60 * 24)
                )
            }
        };
    }

    /**
     * Get open investigations count
     */
    getOpenCasesCount() {
        return this.cases.filter(c => c.status === 'open').length;
    }

    /**
     * Generate unique case ID
     */
    generateCaseId() {
        this.caseCounter++;
        return `CASE-${String(this.caseCounter).padStart(5, '0')}`;
    }

    /**
     * Load data from localStorage
     */
    loadData() {
        const casesSaved = localStorage.getItem('investigationCases');
        if (casesSaved) {
            this.cases = JSON.parse(casesSaved);
        }

        const evidenceSaved = localStorage.getItem('investigationEvidence');
        if (evidenceSaved) {
            const data = JSON.parse(evidenceSaved);
            this.evidence = new Map(data);
        }
    }

    /**
     * Save data to localStorage
     */
    saveData() {
        localStorage.setItem('investigationCases', JSON.stringify(this.cases));
        localStorage.setItem('investigationEvidence', JSON.stringify(Array.from(this.evidence.entries())));
    }

    /**
     * Export case data
     */
    exportCaseData(caseId) {
        const caseObj = this.getCase(caseId);
        const evidence = this.getCaseEvidence(caseId);

        return {
            case: caseObj,
            evidence: evidence,
            exportedAt: new Date().toISOString()
        };
    }

    /**
     * Get statistics
     */
    getStatistics() {
        const closedCases = this.cases.filter(c => c.status === 'closed');
        const openCases = this.cases.filter(c => c.status === 'open');

        return {
            totalCases: this.cases.length,
            openCases: openCases.length,
            closedCases: closedCases.length,
            avgDaysToClose: closedCases.length > 0
                ? closedCases.reduce((sum, c) => {
                    const created = new Date(c.createdAt);
                    const closed = new Date(c.resolution.closedAt);
                    return sum + ((closed - created) / (1000 * 60 * 60 * 24));
                  }, 0) / closedCases.length
                : 0,
            totalEvidence: this.evidence.size
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InvestigationManager;
}
