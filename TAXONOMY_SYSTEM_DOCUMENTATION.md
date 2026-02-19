# Dynamic Taxonomy & Hierarchical Category Mapping

## 🚀 Overview
Issue #706 replaces the rigid, hardcoded category enums with a professional **Taxonomy Engine**. This allows the platform to support complex, multi-level financial classification while maintaining backward compatibility and user flexibility.

## 🏗️ Technical Architecture

### 1. Hierarchical Data Model (`models/Taxonomy.js`)
- **Materialized Paths**: Uses a string-based path system (`/travel/flights/intl/`) for high-performance sub-tree querying using regex or string prefixes.
- **Parent-Child Linkage**: Standard recursive referencing for easy tree building.
- **User Scoping**: Categories can be `isSystem: true` (available to all) or tied to a specific `user` account.

### 2. The Tree Processor (`utils/treeProcessor.js`)
A headless utility that handles the recursion-heavy logic of:
- **Nesting**: Converting flat MongoDB result sets into JSON trees for the UI.
- **Aggregation**: Identifying all sub-category IDs when a user filters by a "Parent" category.
- **Lineage**: Calculating breadcrumbs for transaction detail views.

### 3. Type-Safe Validator (`middleware/taxonomyEnforcer.js`)
As categories are now dynamic, this middleware intercepts mutations to ensure:
1. The category exists and belongs to the user or system.
2. The category "Type" (Income/Expense) matches the transaction "Type".

### 4. Integrity Auditor (`jobs/taxonomyAuditor.js`)
A nightly background process that:
- Ensures Materialized Paths are in sync with parent pointers.
- Flags "Ghost Categories" (references to deleted parents).
- Audits the health of the category-to-transaction mapping.

## 🛠️ API Reference

### `GET /api/taxonomy/tree`
Returns the user's complete category tree in a nested format.

### `GET /api/taxonomy/breadcrumbs/:id`
Returns the lineage of a category for UI navigation.

### `POST /api/taxonomy`
Creates a new custom category.
```json
{
  "name": "Organic Produce",
  "slug": "organic-groceries",
  "parent": "OBJ_ID_OF_GROCERIES",
  "type": "expense"
}
```

## ✅ Implementation Checklist
- [x] Schema with Materialized Path and Level tracking.
- [x] Recursive Tree Processor for UI-ready JSON output.
- [x] Service layer for multi-owner category resolution.
- [x] Middleware for cross-type validation (e.g. preventing "Salary" in "Expense").
- [x] Refactored `Transaction` model to use ObjectId references.
- [x] Background auditor/cleanup job.

## 🧪 Testing
Run the integrity tests:
```bash
npx mocha tests/taxonomy.test.js
```
