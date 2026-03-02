/**
 * Credential Security UI
 * Frontend for credential compromise detection and management
 */

class CredentialSecurityUI {
  constructor() {
    this.userId = this.getUserId();
    this.currentCompromises = [];
    this.selectedCompromise = null;
    
    this.init();
  }

  /**
   * Initialize UI
   */
  async init() {
    this.attachEventListeners();
    await this.checkUserCompromises();
    await this.loadAttackStats();
  }

  /**
   * Get user ID from session/localStorage
   */
  getUserId() {
    // In production, get from session or auth token
    return localStorage.getItem('userId') || 'demo-user';
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Password check
    document.getElementById('checkPasswordBtn').addEventListener('click', () => {
      this.checkPassword();
    });

    // Toggle password visibility
    document.getElementById('togglePassword').addEventListener('click', () => {
      const input = document.getElementById('passwordInput');
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    // Action buttons
    document.getElementById('changePasswordBtn').addEventListener('click', () => {
      window.location.href = '/change-password.html';
    });

    document.getElementById('enable2FABtn').addEventListener('click', () => {
      window.location.href = '/2fa-setup.html';
    });

    document.getElementById('reviewSessionsBtn').addEventListener('click', () => {
      window.location.href = '/sessions.html';
    });

    // Modal
    document.getElementById('closeModal').addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('dismissBtn').addEventListener('click', () => {
      this.closeModal();
    });

    document.getElementById('takeActionBtn').addEventListener('click', () => {
      this.takeAction();
    });
  }

  /**
   * Check user compromises
   */
  async checkUserCompromises() {
    try {
      this.showLoading(true);

      const response = await fetch(`/api/credential-compromise/user/${this.userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (data.success && data.compromises) {
        this.currentCompromises = data.compromises;
        this.updateSecurityStatus(data.compromises);
        
        if (data.compromises.length > 0) {
          this.displayCompromises(data.compromises);
        }
      } else {
        this.updateSecurityStatus([]);
      }

    } catch (error) {
      console.error('Check compromises error:', error);
      this.showError('Failed to check security status');
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * Update security status card
   */
  updateSecurityStatus(compromises) {
    const statusCard = document.getElementById('statusCard');
    const statusIcon = document.getElementById('statusIcon');
    const statusTitle = document.getElementById('statusTitle');
    const statusMessage = document.getElementById('statusMessage');
    const badgeText = document.getElementById('badgeText');

    if (compromises.length === 0) {
      // Secure
      statusCard.className = 'status-card secure';
      statusTitle.textContent = 'Your credentials are secure';
      statusMessage.textContent = 'No compromises detected in our breach databases';
      badgeText.textContent = 'SECURE';
    } else {
      // Get highest risk
      const maxRiskScore = Math.max(...compromises.map(c => c.riskScore));
      const criticalCount = compromises.filter(c => c.riskLevel === 'CRITICAL').length;
      const highCount = compromises.filter(c => c.riskLevel === 'HIGH').length;

      if (criticalCount > 0) {
        statusCard.className = 'status-card critical';
        statusTitle.textContent = 'Critical Security Alert';
        statusMessage.textContent = `${criticalCount} critical compromise${criticalCount > 1 ? 's' : ''} detected. Immediate action required.`;
        badgeText.textContent = 'CRITICAL';
      } else if (highCount > 0) {
        statusCard.className = 'status-card high';
        statusTitle.textContent = 'High Risk Detected';
        statusMessage.textContent = `${highCount} high-risk compromise${highCount > 1 ? 's' : ''} detected. Please review and take action.`;
        badgeText.textContent = 'HIGH RISK';
      } else {
        statusCard.className = 'status-card medium';
        statusTitle.textContent = 'Compromises Detected';
        statusMessage.textContent = `${compromises.length} compromise${compromises.length > 1 ? 's' : ''} found. Review recommended actions.`;
        badgeText.textContent = 'ATTENTION';
      }
    }
  }

  /**
   * Display compromises list
   */
  displayCompromises(compromises) {
    const section = document.getElementById('compromisesSection');
    const list = document.getElementById('compromisesList');

    section.style.display = 'block';
    list.innerHTML = '';

    compromises.forEach(compromise => {
      const card = this.createCompromiseCard(compromise);
      list.appendChild(card);
    });
  }

  /**
   * Create compromise card
   */
  createCompromiseCard(compromise) {
    const card = document.createElement('div');
    card.className = `compromise-card ${compromise.riskLevel.toLowerCase()}`;

    const riskBadge = this.getRiskBadge(compromise.riskLevel);
    const breachList = compromise.breaches.map(b => b.name).join(', ');
    const date = new Date(compromise.discoveredAt).toLocaleDateString();

    card.innerHTML = `
      <div class="compromise-header">
        <div class="compromise-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
            <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="compromise-info">
          <h3>${compromise.compromiseType.replace(/_/g, ' ')}</h3>
          <p class="breach-list">${breachList}</p>
        </div>
        ${riskBadge}
      </div>
      <div class="compromise-details">
        <div class="detail-item">
          <span class="label">Risk Score:</span>
          <span class="value">${compromise.riskScore}/100</span>
        </div>
        <div class="detail-item">
          <span class="label">Breaches:</span>
          <span class="value">${compromise.breachCount}</span>
        </div>
        <div class="detail-item">
          <span class="label">Discovered:</span>
          <span class="value">${date}</span>
        </div>
        <div class="detail-item">
          <span class="label">Status:</span>
          <span class="value status-${compromise.status.toLowerCase()}">${compromise.status}</span>
        </div>
      </div>
      <div class="compromise-actions">
        <button class="btn-small btn-secondary" onclick="credentialSecurityUI.viewCompromiseDetails('${compromise.compromiseId}')">
          View Details
        </button>
        <button class="btn-small btn-primary" onclick="credentialSecurityUI.acknowledgeCompromise('${compromise.compromiseId}')">
          Acknowledge
        </button>
      </div>
    `;

    return card;
  }

  /**
   * Get risk badge HTML
   */
  getRiskBadge(riskLevel) {
    const colors = {
      CRITICAL: '#dc2626',
      HIGH: '#ea580c',
      MEDIUM: '#f59e0b',
      LOW: '#3b82f6',
      INFO: '#6b7280'
    };

    return `<div class="risk-badge" style="background-color: ${colors[riskLevel]}20; color: ${colors[riskLevel]}">
      ${riskLevel}
    </div>`;
  }

  /**
   * View compromise details
   */
  async viewCompromiseDetails(compromiseId) {
    const compromise = this.currentCompromises.find(c => c.compromiseId === compromiseId);
    if (!compromise) return;

    this.selectedCompromise = compromise;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
      <div class="compromise-detail">
        <h3>Breach Information</h3>
        ${compromise.breaches.map(breach => `
          <div class="breach-detail">
            <h4>${breach.name}</h4>
            <p><strong>Date:</strong> ${new Date(breach.date).toLocaleDateString()}</p>
            <p><strong>Severity:</strong> ${breach.severity}</p>
            <p><strong>Compromised Data:</strong> ${breach.dataClasses.join(', ')}</p>
          </div>
        `).join('')}
        
        <h3>Recommended Actions</h3>
        <ul class="action-list">
          <li>Change your password immediately</li>
          <li>Enable two-factor authentication</li>
          <li>Review recent account activity</li>
          <li>Update password on other sites using the same credentials</li>
        </ul>
      </div>
    `;

    document.getElementById('compromiseModal').style.display = 'flex';
  }

  /**
   * Acknowledge compromise
   */
  async acknowledgeCompromise(compromiseId) {
    try {
      this.showLoading(true);

      const response = await fetch(`/api/credential-compromise/${compromiseId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.userId,
          action: 'ACKNOWLEDGED',
          context: {
            acknowledgedAt: new Date().toISOString()
          }
        })
      });

      const data = await response.json();

      if (data.success) {
        this.showSuccess('Compromise acknowledged');
        await this.checkUserCompromises();
      } else {
        this.showError('Failed to acknowledge compromise');
      }

    } catch (error) {
      console.error('Acknowledge error:', error);
      this.showError('Failed to acknowledge compromise');
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * Check password security
   */
  async checkPassword() {
    const password = document.getElementById('passwordInput').value;
    
    if (!password) {
      this.showError('Please enter a password');
      return;
    }

    try {
      this.showLoading(true);

      const response = await fetch('/api/credential-compromise/check-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      this.displayPasswordResult(data);

    } catch (error) {
      console.error('Check password error:', error);
      this.showError('Failed to check password');
    } finally {
      this.showLoading(false);
    }
  }

  /**
   * Display password check result
   */
  displayPasswordResult(data) {
    const resultDiv = document.getElementById('passwordResult');
    resultDiv.style.display = 'block';

    if (data.compromised) {
      resultDiv.className = 'password-result danger';
      resultDiv.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div>
          <strong>Password Compromised!</strong>
          <p>This password appears in ${data.totalBreachCount.toLocaleString()} known breaches. Do not use this password.</p>
        </div>
      `;
    } else {
      resultDiv.className = 'password-result success';
      resultDiv.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <div>
          <strong>Password Secure</strong>
          <p>This password does not appear in known breach databases.</p>
        </div>
      `;
    }
  }

  /**
   * Load attack statistics
   */
  async loadAttackStats() {
    try {
      const response = await fetch('/api/credential-compromise/attack-stats?timeWindow=86400000');
      const data = await response.json();

      if (data.success && data.stats && data.stats.length > 0) {
        this.displayAttackStats(data.stats);
      }

    } catch (error) {
      console.error('Load attack stats error:', error);
    }
  }

  /**
   * Display attack statistics
   */
  displayAttackStats(stats) {
    const section = document.getElementById('attackPatternsSection');
    const container = document.getElementById('attackStats');

    section.style.display = 'block';
    container.innerHTML = '';

    stats.forEach(stat => {
      const card = document.createElement('div');
      card.className = 'attack-stat-card';
      card.innerHTML = `
        <h3>${stat._id.replace(/_/g, ' ')}</h3>
        <div class="stat-value">${stat.count}</div>
        <div class="stat-label">Attacks Detected</div>
        <div class="stat-detail">
          <span>${stat.totalTargetedUsers} users targeted</span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  /**
   * Close modal
   */
  closeModal() {
    document.getElementById('compromiseModal').style.display = 'none';
    this.selectedCompromise = null;
  }

  /**
   * Take action on selected compromise
   */
  async takeAction() {
    if (!this.selectedCompromise) return;

    // Redirect to password change
    window.location.href = '/change-password.html';
  }

  /**
   * Show loading overlay
   */
  showLoading(show) {
    document.getElementById('loadingOverlay').style.display = show ? 'flex' : 'none';
  }

  /**
   * Show error message
   */
  showError(message) {
    alert(message); // In production, use a proper toast/notification system
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    alert(message); // In production, use a proper toast/notification system
  }
}

// Initialize on page load
let credentialSecurityUI;
document.addEventListener('DOMContentLoaded', () => {
  credentialSecurityUI = new CredentialSecurityUI();
});
