import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Box } from '@mui/material';
import DatabaseIndicator from '../components/DatabaseIndicator';
import { StatusContext } from '../context/StatusContext';

const mockStatusValue = (overrides: Partial<{ isDbConnected: boolean }>) => ({
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
    syncStatus: null,
    refreshStatus: async () => { },
    checkDb: async () => { },
    unlockVault: async () => ({ success: true }),
    initializeVault: async () => ({ success: true }),
    migrateVault: async () => ({ success: true }),
    lockVault: async () => ({ success: true }),
    unlockWithPasskey: async () => ({ success: true }),
    startPasskeyRegistration: async () => ({ success: true }),
    clearPasskeys: async () => ({ success: true, cleared: 0 }),
    deletePasskey: async () => ({ success: true }),
    fetchPasskeys: async () => ([]),
    changePassphrase: async () => ({ success: true }),
    setFullPolling: () => { },
    ...overrides,
});

const meta: Meta<typeof DatabaseIndicator> = {
    title: 'Indicators/DatabaseIndicator',
    component: DatabaseIndicator,
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
type Story = StoryObj<typeof DatabaseIndicator>;

export const Connected: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue({ isDbConnected: true })}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const Disconnected: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={mockStatusValue({ isDbConnected: false })}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};
