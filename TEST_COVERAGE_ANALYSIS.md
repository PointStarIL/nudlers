# Test Coverage Analysis

## Current State

The codebase has **38 test files** with approximately **250+ test cases** in `app/tests/`. Testing uses **Vitest** with Node.js environment, database mocking via `vi.mock`, and isolated test execution via forks.

### What's Well-Tested

The existing test suite is strong in several areas:

| Area | Files | Notes |
|------|-------|-------|
| Scraper utilities | `scraperUtils.test.ts` | 50+ tests: category rules, credential prep, transaction insertion, deduplication |
| Transaction listing API | `transactions.test.ts` | 20+ tests: filtering, sorting, pagination, search, type filtering |
| Scraper retry/timeout | `scraper_retry.test.ts`, `scraper_timeout_retry_integration.test.ts` | 47+ tests: boundary values, exponential backoff, timeout propagation |
| WhatsApp integration | `whatsapp.test.ts`, `whatsapp-client.test.ts`, `whatsapp-status-api.test.ts` | 27+ tests: sending, client lifecycle, status API |
| Categorization | `categorization_phases.test.ts` | 7 tests: 3-phase priority system, cache, rules, scraper categories |
| Encryption | `encryption.test.ts` | 5 tests: round-trip, IV randomness, tampering detection |
| Recurring detection | `recurringDetection.test.ts` | 5 tests: monthly/bi-monthly patterns, fuzzy matching |
| Financial reports | Multiple API test files | Budget-vs-actual, monthly summary, recurring payments, projections |

---

## Coverage Gaps

### 1. Category Management APIs — No Tests

**Files:** `pages/api/categories/index.js`, `[name].js`, `apply-rules.js`, `uncategorized.js`, `update-by-description.js`, `merge.js`, `rules/index.js`, `mappings/index.js`

**Risk: High** — Categories are central to the app's value proposition. Every transaction gets categorized, budgets are organized by category, and reports group by category.

**Recommended tests:**
- `categories/index.js`: GET returns distinct categories from transactions
- `categories/[name].js`: PUT renames a category across all transactions; DELETE removes category assignments
- `categories/apply-rules.js`: POST applies rules to uncategorized transactions, skips already-categorized ones
- `categories/merge.js`: POST merges source into target, updates all affected transactions
- `categories/update-by-description.js`: POST bulk-updates category for matching descriptions
- `categories/uncategorized.js`: GET returns only transactions without categories
- `categories/rules/index.js`: CRUD for categorization rules, validation of required fields
- `categories/mappings/index.js`: CRUD for category mappings, circular mapping prevention

### 2. Budget APIs — No Tests

**Files:** `pages/api/budgets/index.js`, `[id].js`

**Risk: High** — Budget tracking is a core feature. Budget amounts feed into budget-vs-actual reports and daily summaries.

**Recommended tests:**
- GET all budgets returns correct structure
- POST creates/updates budget for a category (upsert behavior)
- PUT updates budget amount
- DELETE removes budget
- Validation: reject negative amounts, missing category names

### 3. Individual Transaction Operations — No Tests

**File:** `pages/api/transactions/[id].js`

**Risk: High** — Users manually re-categorize and edit transactions frequently.

**Recommended tests:**
- GET single transaction by ID, 404 for missing ID
- PUT updates category on a transaction
- DELETE removes a specific transaction
- Validation: invalid ID format

### 4. Credential Management APIs — No Tests

**Files:** `pages/api/credentials/index.js`, `[id].js`, `truncate/[id].js`

**Risk: Medium** — Credentials are encrypted at rest and are critical for scraper operation. Bugs here could leak credentials or break scraping.

**Recommended tests:**
- GET lists credentials without exposing decrypted passwords
- POST encrypts and stores new credentials
- PUT updates credentials (re-encrypts)
- DELETE removes credentials
- `truncate/[id].js`: POST deletes all transactions for a credential, returns deletion count
- Verify encryption is applied on write and passwords are never returned in plaintext

### 5. Settings API — No Tests

**File:** `pages/api/settings/index.js`

**Risk: Medium** — Settings control scraper timeouts, billing cycle start day, currency, sync intervals, and more. Bad settings can break scraping or produce incorrect reports.

**Recommended tests:**
- GET returns all settings with defaults for missing keys
- POST updates individual settings
- Validation: type checking for numeric settings (timeout, billing day)

### 6. `apiHandler.js` (createApiHandler) — No Tests

**File:** `pages/api/utils/apiHandler.js`

**Risk: Medium** — This is the foundational abstraction used by many API endpoints. It handles validation, query execution, transformation, error handling, and client release.

**Recommended tests:**
- Validation function returning an error produces 400 response
- Successful query returns transformed data with 200
- Database error produces 500 and logs error
- Client is always released (even on error)
- GET requests get Cache-Control header
- Works without optional validate/transform functions

### 7. Transaction Identifier Generation — No Tests

**File:** `pages/api/utils/transactionUtils.js`

**Risk: High** — `generateTransactionIdentifier` is the primary deduplication mechanism. `normalizeDescription` affects category matching. Bugs here cause duplicate transactions or missed matches.

**Recommended tests:**
- Same transaction input produces the same identifier (deterministic)
- Different amounts produce different identifiers
- Different dates produce different identifiers
- Null/undefined fields are handled gracefully
- `normalizeDescription`: Hebrew text preserved, separators normalized, leading zeros removed, case-insensitive

### 8. Date Utilities — No Tests

**File:** `utils/dateUtils.js`

**Risk: Low-Medium** — Used throughout the app for date formatting. Simple functions but timezone-sensitive.

**Recommended tests:**
- `formatISODate`: Date object → `YYYY-MM-DD`, string input, timestamp input, null/invalid returns `''`
- `getLocalMidnight`: Returns date with zeroed time components, handles string input

### 9. Sync UI Utilities — No Tests

**File:** `utils/sync-ui-utils.ts`

**Risk: Low** — Pure display logic, but easy to test and good for documenting expected behavior.

**Recommended tests:**
- `getSyncStatusLabel`: stopping state, initializing state, null progress, single account, multiple accounts, boundary on `currentNum` capping

### 10. Scraper Execution Flow — No Tests

**Files:** `pages/api/scrapers/run.js`, `run-stream.js`, `sync-all-stream.js`, `stop.js`

**Risk: Medium** — The scraper orchestration endpoints coordinate credential loading, concurrency checks, scraper execution, transaction processing, and audit logging. Currently only the individual utility functions are tested, not the endpoint-level orchestration.

**Recommended tests (at minimum):**
- `run.js`: Validates credentials exist before scraping, checks concurrency, returns audit record
- `stop.js`: Calls stop utilities, returns confirmation
- Method validation (405 for wrong HTTP method)

### 11. Chat/AI APIs — No Tests

**Files:** `pages/api/chat/messages.js`, `stream.js`, `history.js`

**Risk: Low-Medium** — These endpoints manage AI conversation state. Testing the message storage/retrieval and history management is straightforward.

**Recommended tests:**
- `messages.js`: GET retrieves conversation, POST saves message
- `history.js`: GET lists conversations, DELETE clears history
- `stream.js`: Returns SSE response format, handles missing API key

### 12. Component Utility Functions — No Tests

**Files:** `components/CategoryDashboard/utils/categoryUtils.ts`, `dateUtils.ts`, `format.ts`

**Risk: Low** — Pure functions that are good candidates for unit testing.

**Recommended tests:**
- `findBestMatchingIcon`: exact match in defaultIconMap, keyword matching, fallback to default icon
- `generateColorFromString`: deterministic (same input → same color), returns valid HSL
- `formatNumber`: Israeli locale formatting
- `formatCurrencyILS`: currency symbol and formatting
- `dateUtils.formatDate`: DD/MM/YYYY formatting

### 13. `generateDailySummary` — Under-Tested

**File:** `utils/summary.js` (tested in `summary_logic.test.ts`)

**Risk: Medium** — Only 1 test exists. This function generates WhatsApp summaries sent to users daily. It calculates burn rates, budget vs actual, and formats messages.

**Recommended additional tests:**
- No transactions in the period
- All categories over budget
- Mixed currencies
- Missing budget data (unbudgeted categories)
- Billing cycle mode vs calendar month mode

### 14. Backup/Restore Edge Cases — Could Be Stronger

**File:** Tested in `backup_restore.test.ts` (8 tests)

**Recommended additional tests:**
- Import with malformed JSON
- Import with missing required columns
- Export when database is empty
- Verify foreign key order in truncation and restore

---

## Prioritized Recommendations

### Tier 1 — High Impact, Address First

| # | Area | Why |
|---|------|-----|
| 1 | **Transaction identifier generation** (`transactionUtils.js`) | Deduplication correctness is critical — duplicate or missing transactions directly affect financial data |
| 2 | **Category management APIs** (8 endpoints) | Core feature with complex operations (merge, bulk update, rule application) and no test coverage |
| 3 | **Individual transaction CRUD** (`transactions/[id].js`) | Users interact with this constantly for re-categorization |
| 4 | **Budget APIs** (2 endpoints) | Feeds into reports and summaries; upsert logic needs verification |
| 5 | **`createApiHandler`** (`apiHandler.js`) | Foundation for many endpoints; testing it once covers shared behavior |

### Tier 2 — Medium Impact

| # | Area | Why |
|---|------|-----|
| 6 | **Credential management APIs** | Security-sensitive; must verify encryption on storage and no plaintext in responses |
| 7 | **Settings API** | Controls scraper behavior and report calculations |
| 8 | **Scraper orchestration endpoints** | Complex coordination logic currently only tested at the utility level |
| 9 | **`generateDailySummary` additional tests** | Sent to users daily; edge cases in budget/burn rate calculation |

### Tier 3 — Low-Effort Wins

| # | Area | Why |
|---|------|-----|
| 10 | **Date utilities** (`dateUtils.js`) | Small, pure functions; 10 minutes of work for full coverage |
| 11 | **Sync UI utilities** | Pure function, easy to test, documents expected display behavior |
| 12 | **Component format utilities** | Pure functions (`formatNumber`, `formatCurrencyILS`); easy wins |
| 13 | **Chat APIs** | Simple CRUD; straightforward to test |

---

## Structural Observations

1. **No component/UI tests**: The entire test suite is backend-focused. There are no React component tests or integration tests for hooks like `useTransactions`, `useCategoryIcons`, or `useCategoryColors`. Consider adding tests for components with significant logic (e.g., `ScrapeModal`, `BudgetDashboard`), using `@testing-library/react` or Storybook interaction tests.

2. **No integration tests with real database**: All tests mock the database. Consider adding a small suite of integration tests that run against a test PostgreSQL instance to verify actual SQL queries, especially for complex queries in reports and billing cycle calculations.

3. **Consistent mocking patterns**: The existing tests follow good practices with `vi.mock` for database and logger. New tests should follow the same patterns established in existing files for consistency.

4. **Test naming**: Some test files have overlapping names (e.g., multiple `transactionUtils.test.ts`). Use more specific names to avoid confusion.
