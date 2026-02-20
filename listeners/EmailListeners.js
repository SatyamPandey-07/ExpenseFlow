const AppEventBus = require('../utils/AppEventBus');
const EVENTS = require('../config/eventRegistry');
const logger = require('../utils/structuredLogger');

/**
 * Email Notification Listeners
 * Issue #711: Handles all outbound communication side-effects.
 */
class EmailListeners {
    init() {
        console.log('[EmailListeners] Initializing subscription hooks...');

        // Subscribe to User Registration
        AppEventBus.subscribe(EVENTS.USER.REGISTERED, this.handleUserRegistration);

        // Subscribe to Security Events
        AppEventBus.subscribe(EVENTS.SECURITY.LOGIN_FAILURE, this.handleSecurityAlert);
    }

    async handleUserRegistration(user) {
        logger.info(`[EmailService] Sending welcome email to user: ${user.email}`);

        // In a real implementation:
        // await emailProvider.sendTemplate(user.email, 'welcome_v1', { name: user.name });

        return Promise.resolve();
    }

    async handleSecurityAlert(payload) {
        logger.warn(`[EmailService] Sending security alert for suspicious login`, {
            ip: payload.ip,
            email: payload.email
        });

        return Promise.resolve();
    }
}

module.exports = new EmailListeners();
