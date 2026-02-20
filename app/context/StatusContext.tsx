import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../utils/client-logger';

interface SyncStatus {
    syncHealth: string;
    settings: {
        enabled: boolean;
        syncHour: number;
        daysBack: number;
    };
    activeAccounts: number;
    latestScrape: {
        id?: number;
        triggered_by: string;
        vendor: string;
        status: string;
        message?: string;
        created_at: string;
        duration_seconds?: number;
    } | null;
    summary?: {
        oldest_sync_at: string | null;
        has_never_synced: boolean;
    };
    history?: Array<{
        id: number;
        triggered_by: string;
        vendor: string;
        status: string;
        message: string;
        created_at: string;
        duration_seconds?: number;
    }>;
    accountSyncStatus?: Array<{
        id: number;
        nickname: string;
        vendor: string;
        last_synced_at: string | null;
    }>;
}

interface PasskeyInfo {
    id: number;
    credentialId: string;
    createdAt: string;
}

interface StatusContextType {
    isDbConnected: boolean;
    dbError: boolean;
    isVaultLocked: boolean;
    isVaultInitialized: boolean;
    needsMigration: boolean;
    hasPasskeys: boolean;
    passkeysCount: number;
    supportsWebAuthn: boolean;
    isVaultModalOpen: boolean;
    setIsVaultModalOpen: (open: boolean) => void;
    syncStatus: SyncStatus | null;
    refreshStatus: (full?: boolean) => Promise<void>;
    checkDb: () => Promise<void>;
    unlockVault: (passphrase: string) => Promise<{ success: boolean; error?: string }>;
    initializeVault: (passphrase: string) => Promise<{ success: boolean; error?: string }>;
    migrateVault: (passphrase: string) => Promise<{ success: boolean; error?: string }>;
    lockVault: () => Promise<{ success: boolean; error?: string }>;
    startPasskeyRegistration: (passphrase: string) => Promise<{ success: boolean; error?: string }>;
    unlockWithPasskey: () => Promise<{ success: boolean; error?: string }>;
    clearPasskeys: () => Promise<{ success: boolean; cleared?: number; error?: string }>;
    deletePasskey: (id: number) => Promise<{ success: boolean; error?: string }>;
    fetchPasskeys: () => Promise<PasskeyInfo[]>;
    changePassphrase: (currentPassphrase: string, newPassphrase: string) => Promise<{ success: boolean; passkeysCleared?: number; error?: string }>;
    setFullPolling: (full: boolean) => void;
}

const StatusContext = createContext<StatusContextType | undefined>(undefined);

export { StatusContext };

export const useStatus = () => {
    const context = useContext(StatusContext);
    if (!context) {
        throw new Error('useStatus must be used within a StatusProvider');
    }
    return context;
};

export const StatusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isDbConnected, setIsDbConnected] = useState(true);
    const [dbError, setDbError] = useState(false);
    const [isVaultLocked, setIsVaultLocked] = useState(false);
    const [isVaultInitialized, setIsVaultInitialized] = useState(false);
    const [needsMigration, setNeedsMigration] = useState(false);
    const [hasPasskeys, setHasPasskeys] = useState(false);
    const [passkeysCount, setPasskeysCount] = useState(0);
    const [supportsWebAuthn, setSupportsWebAuthn] = useState(false);
    const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [isFullPolling, setIsFullPolling] = useState(false);

    const isRefreshing = useRef(false);
    const isCheckingDb = useRef(false);

    // Detect WebAuthn support once on mount
    useEffect(() => {
        const check = async () => {
            try {
                if (typeof window !== 'undefined' &&
                    window.PublicKeyCredential &&
                    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
                    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
                    setSupportsWebAuthn(available);
                } else {
                    setSupportsWebAuthn(false);
                }
            } catch {
                setSupportsWebAuthn(false);
            }
        };
        check();
    }, []);

    const checkDb = useCallback(async () => {
        if (isCheckingDb.current) return;
        isCheckingDb.current = true;
        try {
            const response = await fetch('/api/ping');
            if (response.ok) {
                const data = await response.json();
                const connected = data.status === 'ok';
                setIsDbConnected(connected);
                setDbError(!connected);
            } else {
                setIsDbConnected(false);
                setDbError(true);
            }
        } catch (error) {
            setIsDbConnected(false);
            setDbError(true);
        } finally {
            isCheckingDb.current = false;
        }
    }, []);

    const refreshStatus = useCallback(async (full = false) => {
        if (isRefreshing.current) return;
        isRefreshing.current = true;
        try {
            // 1. Check Vault Status
            const vaultResp = await fetch('/api/vault/status');
            if (vaultResp.ok) {
                const vaultData = await vaultResp.json();
                setIsVaultLocked(vaultData.locked);
                setIsVaultInitialized(vaultData.initialized);
                setNeedsMigration(vaultData.needsMigration || false);
                setHasPasskeys(vaultData.hasPasskeys || false);
                setPasskeysCount(vaultData.passkeysCount || 0);
            }

            // 2. Refresh Sync Status
            const url = `/api/scrapers/status${(full || isFullPolling) ? '' : '?minimal=true'}`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                // Filter out non-sync events from history if they exist
                if (data.history) {
                    data.history = data.history.filter((e: any) => e.vendor !== 'whatsapp_summary');
                }
                setSyncStatus(data);
            }
        } catch (error) {
            logger.error('Failed to fetch status in context', error as Error);
        } finally {
            isRefreshing.current = false;
        }
    }, [isFullPolling]);

    const unlockVault = useCallback(async (passphrase: string) => {
        try {
            const response = await fetch('/api/vault/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passphrase })
            });

            const data = await response.json();
            if (response.ok) {
                setIsVaultLocked(false);
                refreshStatus(true);
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to unlock vault' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const initializeVault = useCallback(async (passphrase: string) => {
        try {
            const response = await fetch('/api/vault/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passphrase })
            });

            const data = await response.json();
            if (response.ok) {
                setIsVaultLocked(false);
                setIsVaultInitialized(true);
                refreshStatus(true);
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to initialize vault' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const lockVault = useCallback(async () => {
        try {
            const response = await fetch('/api/vault/lock', {
                method: 'POST'
            });

            if (response.ok) {
                setIsVaultLocked(true);
                refreshStatus(true);
                return { success: true };
            }
            return { success: false, error: 'Failed to lock vault' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const migrateVault = useCallback(async (passphrase: string) => {
        try {
            const response = await fetch('/api/vault/migrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passphrase })
            });

            const data = await response.json();
            if (response.ok) {
                setIsVaultLocked(false);
                setIsVaultInitialized(true);
                setNeedsMigration(false);
                refreshStatus(true);
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to migrate vault' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const startPasskeyRegistration = useCallback(async (passphrase: string) => {
        try {
            if (!supportsWebAuthn) {
                return { success: false, error: 'Passkeys are not supported in this browser. A browser with WebAuthn support (e.g. Chrome, Safari, Edge) is required.' };
            }
            const { startRegistration } = await import('@simplewebauthn/browser');

            // 1. Get options from server
            const optionsResp = await fetch('/api/vault/passkey/register-options');
            if (!optionsResp.ok) throw new Error('Failed to get registration options');
            const options = await optionsResp.json();

            // 2. Start registration in browser
            const regResponse = await startRegistration(options);

            // 3. Verify with server
            const verifyResp = await fetch('/api/vault/passkey/register-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ registrationResponse: regResponse, passphrase })
            });

            const verifyData = await verifyResp.json();
            if (verifyResp.ok && verifyData.success) {
                await refreshStatus();
                return { success: true };
            }
            return { success: false, error: verifyData.error || 'Failed to verify passkey' };
        } catch (error) {
            logger.error('Passkey registration failed', error as Error);
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus, supportsWebAuthn]);

    const unlockWithPasskey = useCallback(async () => {
        try {
            if (!supportsWebAuthn) {
                return { success: false, error: 'Passkeys are not supported in this browser.' };
            }
            const { startAuthentication } = await import('@simplewebauthn/browser');

            // 1. Get options from server
            const optionsResp = await fetch('/api/vault/passkey/login-options');
            if (!optionsResp.ok) throw new Error('Failed to get login options');
            const options = await optionsResp.json();

            // 2. Start authentication in browser
            const authResponse = await startAuthentication(options);

            // 3. Verify with server
            const verifyResp = await fetch('/api/vault/passkey/login-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authenticationResponse: authResponse })
            });

            const verifyData = await verifyResp.json();
            if (verifyResp.ok && verifyData.success) {
                setIsVaultLocked(false);
                refreshStatus(true);
                return { success: true };
            }
            return { success: false, error: verifyData.error || 'Failed to verify passkey' };
        } catch (error) {
            logger.error('Passkey login failed', error as Error);
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus, supportsWebAuthn]);

    const clearPasskeys = useCallback(async () => {
        try {
            const response = await fetch('/api/vault/passkey', {
                method: 'DELETE'
            });

            const data = await response.json();
            if (response.ok) {
                await refreshStatus();
                return { success: true, cleared: data.cleared };
            }
            return { success: false, error: data.error || 'Failed to clear passkeys' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const deletePasskey = useCallback(async (id: number) => {
        try {
            const response = await fetch(`/api/vault/passkey/${id}`, {
                method: 'DELETE'
            });

            const data = await response.json();
            if (response.ok) {
                await refreshStatus();
                return { success: true };
            }
            return { success: false, error: data.error || 'Failed to delete passkey' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, [refreshStatus]);

    const fetchPasskeys = useCallback(async (): Promise<PasskeyInfo[]> => {
        try {
            const response = await fetch('/api/vault/passkey');
            if (response.ok) {
                const data = await response.json();
                return data.passkeys || [];
            }
            return [];
        } catch {
            return [];
        }
    }, []);

    const changePassphrase = useCallback(async (currentPassphrase: string, newPassphrase: string) => {
        try {
            const response = await fetch('/api/vault/change-passphrase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassphrase, newPassphrase })
            });

            const data = await response.json();
            if (response.ok) {
                return { success: true, passkeysCleared: data.passkeysCleared };
            }
            return { success: false, error: data.error || 'Failed to change passphrase' };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }, []);

    const setFullPolling = useCallback((full: boolean) => {
        setIsFullPolling(full);
    }, []);

    useEffect(() => {
        // Initial checks
        checkDb();
        refreshStatus();

        let dbIntervalId: NodeJS.Timeout;
        let syncIntervalId: NodeJS.Timeout;

        const setupPolling = () => {
            if (document.hidden) return;

            // Poll DB connection - slower when healthy
            const dbInterval = isDbConnected ? 60000 : 10000;
            dbIntervalId = setInterval(checkDb, dbInterval);

            // Poll Sync Status - faster when syncing
            const isSyncing = syncStatus?.syncHealth === 'syncing';
            const syncInterval = isSyncing ? 5000 : 30000;
            syncIntervalId = setInterval(() => refreshStatus(false), syncInterval);
        };

        const clearPolling = () => {
            if (dbIntervalId) clearInterval(dbIntervalId);
            if (syncIntervalId) clearInterval(syncIntervalId);
        };

        setupPolling();

        const handleVisibilityChange = () => {
            if (document.hidden) {
                clearPolling();
            } else {
                checkDb();
                refreshStatus();
                setupPolling();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Listen for dataRefresh events to force update
        const handleDataRefresh = () => {
            checkDb();
            // Immediate refresh
            refreshStatus(true);
            // Most sync operations take a moment to reflect in status
            // We poll a few times to ensure we catch the 'syncing' status
            setTimeout(() => refreshStatus(true), 1000);
            setTimeout(() => refreshStatus(true), 3000);
        };
        window.addEventListener('dataRefresh', handleDataRefresh);

        return () => {
            clearPolling();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('dataRefresh', handleDataRefresh);
        };
    }, [checkDb, refreshStatus, isDbConnected, syncStatus?.syncHealth]);

    const value = {
        isDbConnected,
        dbError,
        isVaultLocked,
        isVaultInitialized,
        needsMigration,
        hasPasskeys,
        passkeysCount,
        supportsWebAuthn,
        isVaultModalOpen,
        setIsVaultModalOpen,
        syncStatus,
        refreshStatus,
        checkDb,
        unlockVault,
        initializeVault,
        migrateVault,
        lockVault,
        startPasskeyRegistration,
        unlockWithPasskey,
        clearPasskeys,
        deletePasskey,
        fetchPasskeys,
        changePassphrase,
        setFullPolling
    };

    return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
};
