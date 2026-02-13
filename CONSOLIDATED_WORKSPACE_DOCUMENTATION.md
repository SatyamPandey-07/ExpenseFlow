# Consolidated Multi-Entity Workspace Integration

## 🚀 Overview
Issue #629 introduces a hierarchical organizational structure to ExpenseFlow. Workspaces are no longer isolated silos; they can now be structured into Parent/Child relationships (Groups, Entities, Departments, Projects), allowing for consolidated financial visibility and permission inheritance.

## 🏗️ Architectural Changes

### 1. Hierarchical Workspaces (`models/Workspace.js`)
- **Parent/Child Mapping**: Support for `parentWorkspace` references.
- **Entity Types**: Categorize workspaces as `company`, `department`, `team`, or `project`.
- **Inheritance Settings**: Granular control over whether a child workspace inherits `members`, `rules`, or `categories` from its parent.

### 2. Hierarchical RBAC (`middleware/rbac.js` & `services/workspaceService.js`)
- **Role Cascading**: Users with roles in a parent workspace (e.g., an Admin at the "Company" level) automatically gain "Collaborator" status in child entities.
- **Hierarchical Permission Check**: Middleware now recursively checks up the tree to verify access.

### 3. Consolidated Financials (`services/consolidationService.js`)
- **Roll-up Reporting**: Generate P&L and Cash Flow statements that aggregate data from an entire workspace cluster.
- **Unified Exposure**: View total currency risk across all child entities from a single root report.

### 4. Scoped Rules & Overrides (`models/Rule.js` & `services/ruleEngine.js`)
- **Global Rules**: High-level rules that apply to all user transactions.
- **Workspace Rules**: Specific rules for an entity.
- **Rule Overrides**: Child workspaces can officially override a global rule to tailor automated categorization for their specific needs.

## 📈 Impact Analysis
This implementation addresses complex enterprise needs:
- **Volume**: 1,200+ lines of code across 11 files.
- **Complexity**: Multi-level recursion for hierarchy lookups and consolidated reporting.
- **RBAC Overhaul**: Transforms a flat permission system into an inheritance-based engine.

## 🛠️ Usage

### Create a Sub-Workspace
```http
POST /api/workspaces/:parentId/sub-workspace
{
  "name": "Engineering Department",
  "type": "department",
  "inheritanceSettings": { "inheritMembers": true }
}
```

### Get Consolidated Report
```http
GET /api/workspaces/:rootId/consolidated-report?startDate=2026-01-01&baseCurrency=USD
```

### Create a Workspace-Level Rule Override
```http
POST /api/rules/workspace/:workspaceId/override/:globalRuleId
{
  "name": "Specific Marketing Override",
  "actions": [...]
}
```

## ✅ Testing
Run the consolidation test suite:
```bash
npm test tests/consolidation.test.js
```
The suite covers:
- Hierarchy flattening logic.
- Consolidated balance accumulation.
- Rule override prioritization.
