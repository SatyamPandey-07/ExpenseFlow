/**
 * Team Workspace Manager - Multi-User Collaboration Platform
 * 
 * Manages team workspaces, expense circles, member management, and permission control.
 * Enables creation and management of collaborative expense tracking groups.
 * 
 * Features:
 * - Workspace/team creation and management
 * - Member invitation and onboarding
 * - Role-based permission system (Admin, Moderator, Member, Viewer)
 * - Expense circle management (sub-groups within workspaces)
 * - Member activity tracking
 * - Workspace settings and customization
 * - Bulk member operations
 * 
 * @class TeamWorkspaceManager
 * @version 1.0.0
 * @author ExpenseFlow Team
 */

class TeamWorkspaceManager {
  constructor() {
    this.workspaces = new Map(); // workspaceId -> workspace object
    this.currentWorkspace = null;
    this.circles = new Map(); // circleId -> circle object
    this.invitations = new Map(); // invitationId -> invitation object
    this.memberCache = new Map(); // userId -> user object
    
    // Workspace templates
    this.templates = {
      'team': { name: 'Team', description: 'For business teams and departments', roles: ['admin', 'moderator', 'member', 'viewer'] },
      'roommates': { name: 'Roommates', description: 'For shared living expenses', roles: ['admin', 'member'] },
      'project': { name: 'Project', description: 'For project-based expense tracking', roles: ['admin', 'contributor', 'viewer'] },
      'family': { name: 'Family', description: 'For family expense management', roles: ['parent', 'child'] },
      'custom': { name: 'Custom', description: 'Create your own structure', roles: ['admin', 'member'] }
    };
  }

  /**
   * Initialize workspace manager with user data
   * @param {string} userId - Current user ID
   * @returns {Promise<void>}
   */
  async init(userId) {
    try {
      this.userId = userId;
      
      // Load workspaces from storage/API
      const workspaces = await this.loadWorkspaces(userId);
      workspaces.forEach(ws => this.workspaces.set(ws.id, ws));
      
      // Set default workspace if available
      if (workspaces.length > 0) {
        this.currentWorkspace = workspaces[0].id;
      }
      
      console.log(`Loaded ${workspaces.length} workspaces`);
      return true;
    } catch (error) {
      console.error('Error initializing workspace manager:', error);
      throw error;
    }
  }

  /**
   * Create a new workspace/team
   * @param {Object} config - Workspace configuration
   * @param {string} config.name - Workspace name
   * @param {string} config.description - Workspace description
   * @param {string} config.template - Template type (team, roommates, project, family, custom)
   * @param {Object} config.settings - Workspace settings
   * @returns {Object} Created workspace
   */
  createWorkspace(config) {
    const workspace = {
      id: this.generateId('ws'),
      name: config.name,
      description: config.description || '',
      template: config.template || 'custom',
      ownerId: this.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      members: [{
        userId: this.userId,
        role: 'admin',
        joinedAt: new Date().toISOString(),
        addedBy: this.userId
      }],
      settings: {
        currency: config.settings?.currency || 'USD',
        defaultSplitMethod: config.settings?.defaultSplitMethod || 'equal',
        requireApproval: config.settings?.requireApproval || false,
        approvalThreshold: config.settings?.approvalThreshold || 100,
        allowGuestView: config.settings?.allowGuestView || false,
        notificationsEnabled: config.settings?.notificationsEnabled || true,
        ...config.settings
      },
      stats: {
        totalExpenses: 0,
        totalAmount: 0,
        activeMembers: 1,
        monthlyExpenses: 0
      }
    };
    
    this.workspaces.set(workspace.id, workspace);
    this.currentWorkspace = workspace.id;
    
    console.log('Workspace created:', workspace.name);
    
    // Emit event if WebSocket connected
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('workspace:created', workspace);
    }
    
    return workspace;
  }

  /**
   * Update workspace settings
   * @param {string} workspaceId - Workspace ID
   * @param {Object} updates - Settings to update
   * @returns {Object} Updated workspace
   */
  updateWorkspace(workspaceId, updates) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission
    if (!this.hasPermission(workspaceId, this.userId, 'manage_workspace')) {
      throw new Error('Insufficient permissions');
    }
    
    // Update allowed fields
    if (updates.name) workspace.name = updates.name;
    if (updates.description !== undefined) workspace.description = updates.description;
    if (updates.settings) {
      workspace.settings = { ...workspace.settings, ...updates.settings };
    }
    workspace.updatedAt = new Date().toISOString();
    
    console.log('Workspace updated:', workspace.name);
    
    // Broadcast update
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('workspace:updated', { workspaceId, updates });
    }
    
    return workspace;
  }

  /**
   * Delete workspace (soft delete)
   * @param {string} workspaceId - Workspace ID
   * @returns {boolean} Success status
   */
  deleteWorkspace(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Only owner can delete
    if (workspace.ownerId !== this.userId) {
      throw new Error('Only workspace owner can delete');
    }
    
    // Soft delete
    workspace.deletedAt = new Date().toISOString();
    workspace.deletedBy = this.userId;
    
    // Remove from active list
    this.workspaces.delete(workspaceId);
    
    // Switch to another workspace if this was current
    if (this.currentWorkspace === workspaceId) {
      const remaining = Array.from(this.workspaces.values());
      this.currentWorkspace = remaining.length > 0 ? remaining[0].id : null;
    }
    
    console.log('Workspace deleted:', workspace.name);
    
    // Broadcast deletion
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('workspace:deleted', { workspaceId });
    }
    
    return true;
  }

  /**
   * Add member to workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID to add
   * @param {string} role - Member role
   * @returns {Object} Member object
   */
  addMember(workspaceId, userId, role = 'member') {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission
    if (!this.hasPermission(workspaceId, this.userId, 'manage_members')) {
      throw new Error('Insufficient permissions');
    }
    
    // Check if already a member
    if (workspace.members.some(m => m.userId === userId)) {
      throw new Error('User is already a member');
    }
    
    const member = {
      userId,
      role,
      joinedAt: new Date().toISOString(),
      addedBy: this.userId,
      status: 'active'
    };
    
    workspace.members.push(member);
    workspace.stats.activeMembers = workspace.members.filter(m => m.status === 'active').length;
    workspace.updatedAt = new Date().toISOString();
    
    console.log(`Member ${userId} added to workspace ${workspace.name}`);
    
    // Broadcast member addition
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('member:added', { workspaceId, member });
    }
    
    return member;
  }

  /**
   * Remove member from workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID to remove
   * @returns {boolean} Success status
   */
  removeMember(workspaceId, userId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission (admin or removing self)
    const canRemove = this.hasPermission(workspaceId, this.userId, 'manage_members') || userId === this.userId;
    if (!canRemove) {
      throw new Error('Insufficient permissions');
    }
    
    // Cannot remove owner
    if (userId === workspace.ownerId) {
      throw new Error('Cannot remove workspace owner');
    }
    
    workspace.members = workspace.members.filter(m => m.userId !== userId);
    workspace.stats.activeMembers = workspace.members.filter(m => m.status === 'active').length;
    workspace.updatedAt = new Date().toISOString();
    
    console.log(`Member ${userId} removed from workspace ${workspace.name}`);
    
    // Broadcast member removal
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('member:removed', { workspaceId, userId });
    }
    
    return true;
  }

  /**
   * Update member role
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID
   * @param {string} newRole - New role
   * @returns {Object} Updated member
   */
  updateMemberRole(workspaceId, userId, newRole) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission
    if (!this.hasPermission(workspaceId, this.userId, 'manage_members')) {
      throw new Error('Insufficient permissions');
    }
    
    const member = workspace.members.find(m => m.userId === userId);
    if (!member) {
      throw new Error('Member not found');
    }
    
    // Cannot change owner role
    if (userId === workspace.ownerId) {
      throw new Error('Cannot change owner role');
    }
    
    member.role = newRole;
    member.roleChangedAt = new Date().toISOString();
    member.roleChangedBy = this.userId;
    workspace.updatedAt = new Date().toISOString();
    
    console.log(`Member ${userId} role changed to ${newRole}`);
    
    // Broadcast role change
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('member:role_updated', { workspaceId, userId, newRole });
    }
    
    return member;
  }

  /**
   * Create expense circle (sub-group within workspace)
   * @param {string} workspaceId - Workspace ID
   * @param {Object} config - Circle configuration
   * @returns {Object} Created circle
   */
  createCircle(workspaceId, config) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission
    if (!this.hasPermission(workspaceId, this.userId, 'create_circle')) {
      throw new Error('Insufficient permissions');
    }
    
    const circle = {
      id: this.generateId('circle'),
      workspaceId,
      name: config.name,
      description: config.description || '',
      createdBy: this.userId,
      createdAt: new Date().toISOString(),
      members: config.members || [this.userId],
      settings: {
        defaultSplitMethod: config.defaultSplitMethod || workspace.settings.defaultSplitMethod,
        autoIncludeMembers: config.autoIncludeMembers || false
      }
    };
    
    this.circles.set(circle.id, circle);
    
    console.log('Circle created:', circle.name);
    
    // Broadcast circle creation
    if (typeof webSocketSyncManager !== 'undefined' && webSocketSyncManager.isConnectedToServer()) {
      webSocketSyncManager.send('circle:created', circle);
    }
    
    return circle;
  }

  /**
   * Invite user to workspace
   * @param {string} workspaceId - Workspace ID
   * @param {Object} config - Invitation configuration
   * @returns {Object} Invitation object
   */
  inviteUser(workspaceId, config) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    // Check permission
    if (!this.hasPermission(workspaceId, this.userId, 'invite_members')) {
      throw new Error('Insufficient permissions');
    }
    
    const invitation = {
      id: this.generateId('inv'),
      workspaceId,
      workspaceName: workspace.name,
      invitedBy: this.userId,
      invitedAt: new Date().toISOString(),
      email: config.email,
      role: config.role || 'member',
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      message: config.message || ''
    };
    
    this.invitations.set(invitation.id, invitation);
    
    console.log(`Invitation sent to ${config.email}`);
    
    // Send invitation email (would call API endpoint)
    // this.sendInvitationEmail(invitation);
    
    return invitation;
  }

  /**
   * Accept invitation
   * @param {string} invitationId - Invitation ID
   * @param {string} userId - User accepting invitation
   * @returns {Object} Workspace member object
   */
  acceptInvitation(invitationId, userId) {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) {
      throw new Error('Invitation not found');
    }
    
    if (invitation.status !== 'pending') {
      throw new Error('Invitation already processed');
    }
    
    if (new Date(invitation.expiresAt) < new Date()) {
      invitation.status = 'expired';
      throw new Error('Invitation has expired');
    }
    
    // Add member to workspace
    const member = this.addMember(invitation.workspaceId, userId, invitation.role);
    
    // Update invitation status
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date().toISOString();
    invitation.acceptedBy = userId;
    
    console.log(`Invitation accepted by ${userId}`);
    
    return member;
  }

  /**
   * Get workspace members
   * @param {string} workspaceId - Workspace ID
   * @returns {Array} Array of members
   */
  getMembers(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    return workspace.members.filter(m => m.status === 'active');
  }

  /**
   * Get circles for workspace
   * @param {string} workspaceId - Workspace ID
   * @returns {Array} Array of circles
   */
  getCircles(workspaceId) {
    return Array.from(this.circles.values())
      .filter(c => c.workspaceId === workspaceId);
  }

  /**
   * Switch active workspace
   * @param {string} workspaceId - Workspace ID to switch to
   * @returns {Object} Workspace object
   */
  switchWorkspace(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    this.currentWorkspace = workspaceId;
    console.log('Switched to workspace:', workspace.name);
    
    return workspace;
  }

  /**
   * Get current workspace
   * @returns {Object|null} Current workspace
   */
  getCurrentWorkspace() {
    if (!this.currentWorkspace) return null;
    return this.workspaces.get(this.currentWorkspace);
  }

  /**
   * Check if user has permission in workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} userId - User ID
   * @param {string} permission - Permission to check
   * @returns {boolean} Has permission
   */
  hasPermission(workspaceId, userId, permission) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    
    const member = workspace.members.find(m => m.userId === userId);
    if (!member) return false;
    
    // Owner has all permissions
    if (workspace.ownerId === userId) return true;
    
    // Role-based permissions
    const rolePermissions = {
      admin: ['manage_workspace', 'manage_members', 'invite_members', 'create_circle', 'manage_expenses', 'approve_expenses', 'view_all', 'delete_expenses'],
      moderator: ['invite_members', 'create_circle', 'manage_expenses', 'approve_expenses', 'view_all'],
      member: ['create_circle', 'manage_expenses', 'view_all'],
      viewer: ['view_all']
    };
    
    const permissions = rolePermissions[member.role] || [];
    return permissions.includes(permission);
  }

  /**
   * Get workspace statistics
   * @param {string} workspaceId - Workspace ID
   * @returns {Object} Statistics object
   */
  getWorkspaceStats(workspaceId) {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    
    return { ...workspace.stats };
  }

  /**
   * Search workspaces
   * @param {string} query - Search query
   * @returns {Array} Matching workspaces
   */
  searchWorkspaces(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.workspaces.values())
      .filter(ws => 
        ws.name.toLowerCase().includes(lowerQuery) ||
        ws.description.toLowerCase().includes(lowerQuery)
      );
  }

  /**
   * Get all workspaces for current user
   * @returns {Array} Array of workspaces
   */
  getAllWorkspaces() {
    return Array.from(this.workspaces.values());
  }

  /**
   * Load workspaces from storage/API
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of workspaces
   */
  async loadWorkspaces(userId) {
    // In production, this would fetch from API
    // For now, return empty array or load from localStorage
    
    try {
      const stored = localStorage.getItem(`workspaces_${userId}`);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Error loading workspaces:', error);
    }
    
    return [];
  }

  /**
   * Save workspaces to storage
   * @returns {Promise<boolean>} Success status
   */
  async saveWorkspaces() {
    try {
      const workspacesArray = Array.from(this.workspaces.values());
      localStorage.setItem(`workspaces_${this.userId}`, JSON.stringify(workspacesArray));
      return true;
    } catch (error) {
      console.error('Error saving workspaces:', error);
      return false;
    }
  }

  /**
   * Generate unique ID
   * @param {string} prefix - ID prefix
   * @returns {string} Unique ID
   */
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available templates
   * @returns {Object} Templates object
   */
  getTemplates() {
    return { ...this.templates };
  }
}

// Global instance
const teamWorkspaceManager = new TeamWorkspaceManager();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TeamWorkspaceManager;
}
