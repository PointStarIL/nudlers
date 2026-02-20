import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { Box } from '@mui/material';
import VaultLockScreen from '../components/VaultLockScreen';
import { StatusContext } from '../context/StatusContext';

const baseMockValue = {
    isDbConnected: true,
    dbError: false,
    isVaultLocked: true,
    isVaultInitialized: true,
    needsMigration: false,
    hasPasskeys: false,
    passkeysCount: 0,
    supportsWebAuthn: true,
    isVaultModalOpen: true,
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
    fetchPasskeys: async () => [],
    changePassphrase: async () => ({ success: true }),
    setFullPolling: () => { },
};

const meta: Meta<typeof VaultLockScreen> = {
    title: 'Components/VaultLockScreen',
    component: VaultLockScreen,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (
            <Box sx={{ width: 600, height: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof VaultLockScreen>;

export const UnlockWithPassphrase: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: true,
                isVaultInitialized: true,
                isVaultModalOpen: true,
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const UnlockWithPasskey: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: true,
                isVaultInitialized: true,
                hasPasskeys: true,
                passkeysCount: 2,
                isVaultModalOpen: true,
                unlockWithPasskey: async () => {
                    await new Promise(r => setTimeout(r, 2000));
                    return { success: true };
                },
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const InitializeVault: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: false,
                isVaultInitialized: false,
                needsMigration: false,
                isVaultModalOpen: true,
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const MigrateFromLegacy: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: false,
                isVaultInitialized: false,
                needsMigration: true,
                isVaultModalOpen: true,
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const UnlockError: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: true,
                isVaultInitialized: true,
                isVaultModalOpen: true,
                unlockVault: async () => ({ success: false, error: 'Invalid passphrase' }),
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};

export const PasskeyError: Story = {
    decorators: [
        (Story) => (
            <StatusContext.Provider value={{
                ...baseMockValue,
                isVaultLocked: true,
                isVaultInitialized: true,
                hasPasskeys: true,
                passkeysCount: 1,
                isVaultModalOpen: true,
                unlockWithPasskey: async () => ({ success: false, error: 'Passkey verification failed' }),
            }}>
                <Story />
            </StatusContext.Provider>
        ),
    ],
};
