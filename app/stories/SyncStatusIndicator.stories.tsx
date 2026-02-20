import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Box } from '@mui/material';
import SyncStatusIndicator from '../components/SyncStatusIndicator';
import { StatusContext } from '../context/StatusContext';

const makeSyncStatus = (health: string, accounts = 3) => ({
    syncHealth: health,
    settings: { enabled: true, syncHour: 6, daysBack: 30 },
    activeAccounts: accounts,
    latestScrape: health === 'no_accounts' ? null : {
        triggered_by: 'schedule',
        vendor: 'hapoalim',
        status: health === 'error' ? 'error' : 'success',
        created_at: new Date().toISOString(),
    },
    summary: {
        oldest_sync_at: health === 'never_synced' ? null : new Date(Date.now() - 3600000).toISOString(),
        has_never_synced: health === 'never_synced',
    },
});

const mockStatusValue = (health: string, accounts?: number) => ({
    isDbConnected: true,
    dbError: false,
    isVaultLocked: false,
    isVaultInitialized: true,
    needsMigration: false,
    hasPasskeys: false,
    passkeysCount: 0,
    supportsWebAuthn: true,
    isVaultModalOpen: false,
    setIsVaultModalOpen: () => { },
    syncStatus: makeSyncStatus(health, accounts),
    refreshStatus: async () => { },
    checkDb: async () => { },
    unlockVault: async () => ({ success: true as const }),
    initializeVault: async () => ({ success: true as const }),
    migrateVault: async () => ({ success: true as const }),
    lockVault: async () => ({ success: true as const }),
    unlockWithPasskey: async () => ({ success: true as const }),
    startPasskeyRegistration: async () => ({ success: true as const }),
    clearPasskeys: async () => ({ success: true as const, cleared: 0 }),
    deletePasskey: async () => ({ success: true as const }),
    fetchPasskeys: async () => ([]),
    changePassphrase: async () => ({ success: true as const }),
    setFullPolling: () => { },
});

const meta: Meta<typeof SyncStatusIndicator> = {
    title: 'Indicators/SyncStatusIndicator',
    component: SyncStatusIndicator,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (
            <Box sx={{ p: 4 }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof SyncStatusIndicator>;

export const Healthy: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('healthy')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const Syncing: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('syncing')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const Error: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('error')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const Stale: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('stale')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const Outdated: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('outdated')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const NoAccounts: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('no_accounts', 0)}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};

export const NeverSynced: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue('never_synced')}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
    args: { onClick: () => { } },
};
