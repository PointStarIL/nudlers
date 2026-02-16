# CLAUDE.md - AI Assistant Guidelines for Nudlers

This document provides comprehensive guidance for AI assistants working with the Nudlers codebase.

## Project Overview

Nudlers is a personal finance management application built with Next.js that aggregates transactions from Israeli banks and credit card companies. It provides expense tracking, budgeting, categorization, and reporting features.

### Core Features
- **Transaction Scraping**: Automated fetching from Israeli banks (Hapoalim, Leumi, Discount, etc.) and credit card providers (Visa Cal, Max, Isracard, Amex)
- **Category Management**: Auto-categorization with rules and manual override
- **Budget Tracking**: Monthly budgets with category-level tracking
- **WhatsApp Notifications**: Daily/weekly summary reports via WhatsApp
- **AI Assistant**: Gemini-powered chat for financial insights
- **MCP Integration**: Model Context Protocol support for AI tools

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16+ (Pages Router) |
| Language | TypeScript / JavaScript |
| Database | PostgreSQL |
| UI Framework | Material-UI (MUI) v6 |
| Styling | CSS Variables + MUI ThemeProvider |
| Testing | Vitest |
| Component Dev | Storybook 10 |
| Scraping | israeli-bank-scrapers + Puppeteer |
| Logging | Pino |
| Runtime | Node.js 22+ |

## Directory Structure

```
nudlers/
├── app/                          # Main application directory
│   ├── components/               # React components
│   │   ├── CategoryDashboard/    # Main dashboard with sub-components
│   │   ├── Layout.tsx            # App layout with view switching
│   │   └── *.tsx                 # Feature components
│   ├── config/                   # Configuration modules
│   │   └── resource-config.js    # Resource mode settings (normal/low)
│   ├── context/                  # React contexts
│   │   ├── ThemeContext.tsx      # Light/dark theme management
│   │   ├── StatusContext.tsx     # App status (DB connection, etc.)
│   │   └── DateSelectionContext.tsx
│   ├── pages/                    # Next.js pages
│   │   ├── api/                  # API routes
│   │   │   ├── transactions/     # Transaction CRUD
│   │   │   ├── categories/       # Category management
│   │   │   ├── scrapers/         # Scraper control
│   │   │   ├── reports/          # Financial reports
│   │   │   ├── credentials/      # Encrypted bank credentials
│   │   │   ├── settings/         # App settings
│   │   │   └── db.js             # Database connection pool
│   │   └── index.tsx             # Main page entry
│   ├── scrapers/                 # Bank scraper logic
│   │   ├── core.js               # Shared scraper utilities
│   │   └── CustomVisaCalScraper.js
│   ├── styles/                   # Styling
│   │   ├── design-tokens.css     # CSS custom properties
│   │   ├── theme.ts              # MUI theme configuration
│   │   └── globals.css
│   ├── stories/                  # Storybook stories
│   ├── tests/                    # Test files
│   └── utils/                    # Shared utilities
│       ├── constants.js          # App constants and vendor lists
│       ├── logger.js             # Pino logger instance
│       ├── whatsapp.js           # WhatsApp integration
│       └── transaction_logic.js  # Business logic for transactions
└── .gitignore
```

## Development Commands

All commands should be run from the `app/` directory:

```bash
# Development
npm run dev          # Start dev server on port 6969

# Build & Production
npm run build        # Build for production
npm start            # Start production server

# Testing
npm run test         # Run Vitest tests

# Linting
npm run lint         # Run ESLint

# Storybook
npm run storybook    # Start Storybook on port 6006
```

## Code Conventions

### API Routes

API routes follow a consistent pattern using `createApiHandler`:

```javascript
// pages/api/example/index.js
import { createApiHandler } from "../utils/apiHandler";
import { getDB } from "../db";

const handler = async (req, res) => {
    if (req.method === 'GET') {
        return getHandler(req, res);
    } else if (req.method === 'POST') {
        return postHandler(req, res);
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
};

const getHandler = createApiHandler({
    validate: (req) => {
        // Return error string if invalid, undefined if valid
        if (!req.query.required) return "required is required";
    },
    query: async (req) => ({
        sql: 'SELECT * FROM table WHERE column = $1',
        params: [req.query.param]
    }),
    transform: (result) => result.rows
});

export default handler;
```

### Database Queries

Always use parameterized queries and release clients:

```javascript
import { getDB } from "../db";

const client = await getDB();
try {
    const result = await client.query('SELECT * FROM table WHERE id = $1', [id]);
    // Handle result
} finally {
    client.release();
}
```

### React Components

Components use TypeScript with MUI styling:

```tsx
import React from 'react';
import { Box, Typography } from '@mui/material';

interface ComponentProps {
    title: string;
    onAction?: () => void;
}

const MyComponent: React.FC<ComponentProps> = ({ title, onAction }) => {
    return (
        <Box sx={{
            p: 2,
            backgroundColor: 'var(--n-bg-surface)',
            borderRadius: 'var(--n-radius-lg)'
        }}>
            <Typography variant="h6" color="var(--n-text-primary)">
                {title}
            </Typography>
        </Box>
    );
};

export default MyComponent;
```

### Testing

Tests use Vitest with mocks for database and external services:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../pages/api/db', () => ({
    getDB: vi.fn()
}));

vi.mock('../utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

describe('Feature', () => {
    let mockClient;

    beforeEach(() => {
        vi.clearAllMocks();
        mockClient = {
            query: vi.fn(),
            release: vi.fn()
        };
        (getDB as any).mockResolvedValue(mockClient);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should do something', async () => {
        mockClient.query.mockResolvedValue({ rows: [] });
        // Test logic
    });
});
```

## Styling System

### Design Tokens

The app uses CSS custom properties for theming (see `styles/design-tokens.css`):

```css
/* Usage in components */
.element {
    background: var(--n-bg-surface);
    color: var(--n-text-primary);
    border: 1px solid var(--n-border);
    border-radius: var(--n-radius-lg);
    box-shadow: var(--n-shadow-md);
}
```

Key token prefixes:
- `--n-bg-*`: Background colors
- `--n-text-*`: Text colors
- `--n-border*`: Border colors
- `--n-primary-*`: Primary/accent colors
- `--n-space-*`: Spacing values
- `--n-radius-*`: Border radius
- `--n-shadow-*`: Box shadows

### Theme Switching

Themes are controlled via `data-theme` attribute on `<html>`:
- `[data-theme='light']` - Light theme tokens
- `[data-theme='dark']` - Dark theme tokens (default)

## Key Concepts

### Vendors

Vendors are categorized into:
- **Credit Card**: `visaCal`, `max`, `isracard`, `amex`
- **Standard Banks**: `hapoalim`, `leumi`, `mizrahi`, `discount`, etc.
- **Beinleumi Group**: `otsarHahayal`, `beinleumi`, `massad`, `pagi`

### Billing Cycle

Transactions are grouped by billing cycle (configurable start day, default: 10th) rather than calendar month for credit card charges.

### Resource Modes

The app supports different resource configurations via `RESOURCE_MODE` environment variable:
- `normal`: Standard servers (2GB+ RAM)
- `low`: NAS devices (Synology, QNAP)

## Environment Variables

```bash
# Database
NUDLERS_DB_USER=
NUDLERS_DB_HOST=
NUDLERS_DB_NAME=
NUDLERS_DB_PASSWORD=
NUDLERS_DB_PORT=5432

# Vault (stored in database app_settings table, not in env vars)

# Resource Mode
RESOURCE_MODE=normal  # normal | low

# Optional
GEMINI_API_KEY=       # For AI assistant
LOG_LEVEL=info        # Logging level
```

## Important Files to Know

| File | Purpose |
|------|---------|
| `app/pages/api/db.js` | PostgreSQL connection pool |
| `app/config/resource-config.js` | Resource optimization settings (normal/low) |
| `app/utils/constants.js` | Vendor lists, settings keys, timeouts |
| `app/scrapers/core.js` | Shared scraper utilities and anti-detection |
| `app/components/Layout.tsx` | Main app layout with view routing |
| `app/context/ThemeContext.tsx` | Theme provider |
| `app/styles/design-tokens.css` | CSS custom properties |
| `app/styles/theme.ts` | MUI theme configuration |

## Common Tasks

### Adding a New API Endpoint

1. Create file in `app/pages/api/[feature]/index.js`
2. Use `createApiHandler` pattern for database operations
3. Add validation, query, and transform functions
4. Handle multiple HTTP methods in main handler

### Adding a New Component

1. Create in `app/components/[ComponentName].tsx`
2. Use TypeScript interfaces for props
3. Use MUI components and CSS variables for styling
4. Add to relevant view in `Layout.tsx` if it's a main view

### Adding Tests

1. Create `app/tests/[feature].test.ts`
2. Mock `getDB`, `logger`, and external services
3. Use `beforeEach`/`afterEach` for setup/teardown
4. Test both success and error paths

### Modifying Scraper Behavior

1. Check `app/scrapers/core.js` for shared options
2. Rate-limited vendors need special handling (delays, longer timeouts)
3. Test changes with `npm run scrape` before committing

## Gotchas and Tips

1. **Database connections**: Always call `client.release()` in a `finally` block
2. **Encryption**: Credentials are encrypted at rest; the application uses a Memory-Locked Vault. Ensure you handle `VaultLockedError` and use `encrypt()`/`decrypt()` from `utils/encryption.js`.
3. **Scraper timeouts**: Default 90s, configurable via settings or resource mode
4. **Theme colors**: Always use CSS variables (`var(--n-*)`) for theme compatibility
5. **Date handling**: Use `date-fns` for date manipulation
6. **Logging**: Use the `logger` from `utils/logger.js`, not `console.log`
7. **Tests**: Database tests should mock `getDB`, not use real connections

## Storybook

Stories are located in `app/stories/`. Run with `npm run storybook`.

Component stories should follow this pattern:
```tsx
// ComponentName.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import ComponentName from '../components/ComponentName';

const meta: Meta<typeof ComponentName> = {
    title: 'Components/ComponentName',
    component: ComponentName,
};

export default meta;
type Story = StoryObj<typeof ComponentName>;

export const Default: Story = {
    args: {
        // Default props
    },
};
```

## Contributing Guidelines

1. Run `npm run lint` before committing
2. Add tests for new features
3. Use TypeScript for new files when possible
4. Follow existing patterns for consistency
5. Update this CLAUDE.md if adding significant new patterns or conventions
