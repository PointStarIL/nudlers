import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, TextField, Button, Dialog, DialogContent, InputAdornment, IconButton, CircularProgress, Alert } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import KeyIcon from '@mui/icons-material/Key';
import CloseIcon from '@mui/icons-material/Close';
import { styled } from '@mui/material/styles';
import { useStatus } from '../context/StatusContext';

const GlowSphere = styled(Box)(({ color }: { color: string }) => ({
    position: 'absolute',
    width: '300px',
    height: '300px',
    background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
    filter: 'blur(60px)',
    zIndex: -1,
    opacity: 0.4,
}));

const StyledDialog = styled(Dialog)({
    '& .MuiPaper-root': {
        borderRadius: 'var(--n-radius-2xl)',
        background: 'var(--n-glass-bg)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--n-glass-border)',
        boxShadow: 'var(--n-shadow-xl)',
        overflow: 'hidden',
        maxWidth: '450px',
        width: '100%',
    }
});

type AuthMode = 'passkey' | 'passphrase';

const VaultLockScreen: React.FC = () => {
    const {
        unlockVault, initializeVault, migrateVault,
        unlockWithPasskey, startPasskeyRegistration,
        isVaultInitialized, needsMigration, hasPasskeys,
        isVaultModalOpen, setIsVaultModalOpen,
        supportsWebAuthn,
    } = useStatus();

    const [passphrase, setPassphrase] = useState('');
    const [confirmPassphrase, setConfirmPassphrase] = useState('');
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPasskeySetup, setShowPasskeySetup] = useState(false);

    // Determine mode: migrate > init > unlock
    const isMigrate = needsMigration;
    const isInit = !isVaultInitialized && !needsMigration;
    const isUnlock = isVaultInitialized && !needsMigration;

    // Default to passkey if passkeys are registered and we're in unlock mode
    const [authModeOverride, setAuthModeOverride] = useState<AuthMode | null>(null);
    const authMode: AuthMode = authModeOverride ?? (isUnlock && hasPasskeys && supportsWebAuthn && isVaultModalOpen ? 'passkey' : 'passphrase');

    // Prevent auto-trigger loop
    const hasAutoTriggered = useRef(false);

    const handleClose = () => {
        if (!loading) {
            setIsVaultModalOpen(false);
            setError(null);
            setPassphrase('');
            setConfirmPassphrase('');
            setShowPasskeySetup(false);
            setAuthModeOverride(null);
            hasAutoTriggered.current = false;
        }
    };

    const handlePasskeyUnlock = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await unlockWithPasskey();
        if (!result.success) {
            // Check for user cancellation or timeout
            const errorMessage = result.error || '';
            const isCancelled = errorMessage.includes('NotAllowedError') ||
                errorMessage.includes('not allowed') ||
                errorMessage.includes('timed out') ||
                errorMessage.includes('User cancelled') ||
                errorMessage.includes('AbortError') ||
                errorMessage.includes('aborted');

            if (isCancelled) {
                // Determine if we should fallback to passphrase
                // If it was a cancellation, we likely want to show the passphrase screen
                setAuthModeOverride('passphrase');
                // Don't show an error for explicit cancellation, it's annoying
                setError(null);
            } else {
                setError(result.error || 'Passkey authentication failed');
            }
        } else {
            setIsVaultModalOpen(false);
            setPassphrase('');
        }
        setLoading(false);
    }, [unlockWithPasskey, setIsVaultModalOpen]);

    // Auto-trigger passkey when modal opens and passkeys are available.
    useEffect(() => {
        if (isVaultModalOpen && isUnlock && hasPasskeys && supportsWebAuthn && authMode === 'passkey' && !loading && !hasAutoTriggered.current) {
            hasAutoTriggered.current = true;
            handlePasskeyUnlock();
        }
    }, [isVaultModalOpen, authMode, isUnlock, hasPasskeys, supportsWebAuthn, loading, handlePasskeyUnlock]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!passphrase) return;

        const isActionInitOrMigrate = isInit || isMigrate;

        if (isActionInitOrMigrate && passphrase !== confirmPassphrase) {
            setError('Passphrases do not match');
            return;
        }

        if (isActionInitOrMigrate && passphrase.length < 8) {
            setError('Passphrase must be at least 8 characters long');
            return;
        }

        setLoading(true);
        setError(null);

        let result;

        if (needsMigration) {
            result = await migrateVault(passphrase);
        } else if (isVaultInitialized) {
            result = await unlockVault(passphrase);
        } else {
            result = await initializeVault(passphrase);
        }

        if (!result.success) {
            setError(result.error || 'Failed to process request');
            setLoading(false);
        } else {
            setLoading(false);
            if (isActionInitOrMigrate && supportsWebAuthn) {
                setShowPasskeySetup(true);
            } else {
                setIsVaultModalOpen(false);
                setPassphrase('');
                setConfirmPassphrase('');
            }
        }
    };

    return (
        <StyledDialog
            open={isVaultModalOpen || false}
            onClose={handleClose}
            fullWidth
        >
            <Box sx={{ position: 'relative', overflow: 'hidden' }}>
                <GlowSphere color="rgba(99, 102, 241, 0.3)" sx={{ top: '-150px', left: '-150px' }} />
                <GlowSphere color="rgba(236, 72, 153, 0.2)" sx={{ bottom: '-150px', right: '-150px' }} />

                <IconButton
                    onClick={handleClose}
                    disabled={loading}
                    sx={{ position: 'absolute', right: 16, top: 16, color: 'var(--n-text-secondary)', zIndex: 10 }}
                >
                    <CloseIcon />
                </IconButton>

                <DialogContent sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--n-text-primary)', position: 'relative', zIndex: 1 }}>
                    {showPasskeySetup ? (
                        <>
                            <Box sx={{
                                p: 2,
                                borderRadius: '50%',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                mb: 3,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FingerprintIcon sx={{ fontSize: '48px', color: 'var(--n-success)' }} />
                            </Box>

                            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1, textAlign: 'center' }}>
                                Enable Biometric?
                            </Typography>

                            <Typography variant="body1" sx={{ color: 'var(--n-text-secondary)', mb: 4, textAlign: 'center' }}>
                                Unlock your vault instantly with TouchID or FaceID next time. No need to type your passphrase.
                            </Typography>

                            {error && (
                                <Alert severity="error" sx={{ width: '100%', mb: 3, borderRadius: 'var(--n-radius-lg)' }}>
                                    {error}
                                </Alert>
                            )}

                            <Button
                                fullWidth
                                variant="contained"
                                onClick={async () => {
                                    setLoading(true);
                                    setError(null);
                                    const result = await startPasskeyRegistration(passphrase);
                                    if (result.success) {
                                        setIsVaultModalOpen(false);
                                        setPassphrase('');
                                        setShowPasskeySetup(false);
                                    } else {
                                        setError(result.error || 'Passkey registration failed');
                                    }
                                    setLoading(false);
                                }}
                                disabled={loading}
                                sx={{
                                    py: 1.5,
                                    borderRadius: 'var(--n-radius-xl)',
                                    textTransform: 'none',
                                    fontSize: '1.1rem',
                                    fontWeight: 700,
                                    background: 'linear-gradient(135deg, var(--n-success) 0%, #059669 100%)',
                                    boxShadow: '0 10px 15px -12px rgba(16, 185, 129, 0.4)',
                                    '&:hover': {
                                        background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                                    },
                                }}
                            >
                                {loading ? <CircularProgress size={24} color="inherit" /> : 'Yes, Enable Passkey'}
                            </Button>

                            <Button
                                fullWidth
                                variant="text"
                                onClick={() => {
                                    setIsVaultModalOpen(false);
                                    setPassphrase('');
                                    setShowPasskeySetup(false);
                                }}
                                disabled={loading}
                                sx={{
                                    mt: 2,
                                    color: 'var(--n-text-secondary)',
                                    textTransform: 'none',
                                    '&:hover': {
                                        color: 'var(--n-text-primary)',
                                        backgroundColor: 'transparent'
                                    }
                                }}
                            >
                                Skip for now
                            </Button>
                        </>
                    ) : authMode === 'passkey' && isUnlock ? (
                        // Passkey-first unlock screen
                        <>
                            <Box sx={{
                                p: 2,
                                borderRadius: '50%',
                                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                mb: 3,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <FingerprintIcon sx={{ fontSize: '48px', color: 'var(--n-primary-400)' }} />
                            </Box>

                            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1, textAlign: 'center' }}>
                                Unlock with Passkey
                            </Typography>

                            <Typography variant="body1" sx={{ color: 'var(--n-text-secondary)', mb: 4, textAlign: 'center' }}>
                                Use your biometric or security key to unlock the vault.
                            </Typography>

                            {error && (
                                <Alert severity="error" sx={{ width: '100%', mb: 3, borderRadius: 'var(--n-radius-lg)' }}>
                                    {error}
                                </Alert>
                            )}

                            <Button
                                fullWidth
                                variant="contained"
                                onClick={handlePasskeyUnlock}
                                disabled={loading}
                                startIcon={loading ? undefined : <FingerprintIcon />}
                                sx={{
                                    py: 1.5,
                                    borderRadius: 'var(--n-radius-xl)',
                                    textTransform: 'none',
                                    fontSize: '1.1rem',
                                    fontWeight: 700,
                                    background: 'linear-gradient(135deg, var(--n-primary-500) 0%, var(--n-primary-600) 100%)',
                                    boxShadow: '0 10px 15px -12px rgba(79, 70, 229, 0.4)',
                                    '&:hover': {
                                        background: 'linear-gradient(135deg, var(--n-primary-600) 0%, var(--n-primary-700) 100%)',
                                    },
                                    '&.Mui-disabled': {
                                        background: 'var(--n-bg-surface-alt)',
                                        color: 'var(--n-text-muted)'
                                    }
                                }}
                            >
                                {loading ? <CircularProgress size={24} color="inherit" /> : 'Authenticate'}
                            </Button>

                            <Button
                                fullWidth
                                variant="text"
                                onClick={() => {
                                    setAuthModeOverride('passphrase');
                                    hasAutoTriggered.current = true; // Also treat manual switch as "already triggered" to prevent flip-flop
                                    setError(null);
                                }}
                                disabled={loading}
                                startIcon={<KeyIcon />}
                                sx={{
                                    mt: 2,
                                    color: 'var(--n-text-secondary)',
                                    textTransform: 'none',
                                    '&:hover': {
                                        color: 'var(--n-text-primary)',
                                        backgroundColor: 'transparent'
                                    }
                                }}
                            >
                                Use passphrase instead
                            </Button>
                        </>
                    ) : (
                        // Passphrase unlock / init / migrate screen
                        <>
                            <Box sx={{
                                p: 2,
                                borderRadius: '50%',
                                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                mb: 3,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <LockOutlinedIcon sx={{ fontSize: '48px', color: 'var(--n-primary-400)' }} />
                            </Box>

                            <Typography variant="h4" sx={{ fontWeight: 800, mb: 1, textAlign: 'center' }}>
                                {isMigrate ? 'Migrate to Vault' : isInit ? 'Setup Vault' : 'Unlock Vault'}
                            </Typography>

                            <Typography variant="body1" sx={{ color: 'var(--n-text-secondary)', mb: 4, textAlign: 'center' }}>
                                {isMigrate
                                    ? 'Your credentials are currently using a legacy encryption key. Create a vault passphrase to upgrade to the secure Memory-Locked Vault.'
                                    : isInit
                                        ? 'Create a passphrase to secure your bank and credit card credentials in memory.'
                                        : 'Credentials are encrypted and locked in memory. Enter your passphrase to continue.'}
                            </Typography>

                            {error && (
                                <Alert severity="error" sx={{ width: '100%', mb: 3, borderRadius: 'var(--n-radius-lg)' }}>
                                    {error}
                                </Alert>
                            )}

                            <form onSubmit={handleSubmit} style={{ width: '100%' }}>
                                <TextField
                                    fullWidth
                                    type={showPassphrase ? 'text' : 'password'}
                                    placeholder={isInit ? "Create passphrase" : "Enter passphrase"}
                                    value={passphrase}
                                    onChange={(e) => setPassphrase(e.target.value)}
                                    disabled={loading}
                                    variant="outlined"
                                    autoFocus
                                    InputProps={{
                                        startAdornment: (
                                            <InputAdornment position="start">
                                                <KeyIcon sx={{ color: 'var(--n-primary-500)' }} />
                                            </InputAdornment>
                                        ),
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    onClick={() => setShowPassphrase(!showPassphrase)}
                                                    edge="end"
                                                    sx={{ color: 'var(--n-text-secondary)' }}
                                                >
                                                    {showPassphrase ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                        sx: {
                                            borderRadius: 'var(--n-radius-xl)',
                                            backgroundColor: 'var(--n-bg-surface-alt)',
                                            color: 'var(--n-text-primary)',
                                            '& fieldset': { borderColor: 'var(--n-border)' },
                                            '&:hover fieldset': { borderColor: 'var(--n-primary-400) !important' },
                                            '&.Mui-focused fieldset': { borderColor: 'var(--n-primary-500) !important' },
                                        }
                                    }}
                                    sx={{ mb: (isInit || isMigrate) ? 2 : 3 }}
                                />

                                {(isInit || isMigrate) && (
                                    <TextField
                                        fullWidth
                                        type={showPassphrase ? 'text' : 'password'}
                                        placeholder="Confirm passphrase"
                                        value={confirmPassphrase}
                                        onChange={(e) => setConfirmPassphrase(e.target.value)}
                                        disabled={loading}
                                        variant="outlined"
                                        InputProps={{
                                            startAdornment: (
                                                <InputAdornment position="start">
                                                    <KeyIcon sx={{ color: 'var(--n-primary-500)' }} />
                                                </InputAdornment>
                                            ),
                                            sx: {
                                                borderRadius: 'var(--n-radius-xl)',
                                                backgroundColor: 'var(--n-bg-surface-alt)',
                                                color: 'var(--n-text-primary)',
                                                '& fieldset': { borderColor: 'var(--n-border)' },
                                                '&:hover fieldset': { borderColor: 'var(--n-primary-400) !important' },
                                                '&.Mui-focused fieldset': { borderColor: 'var(--n-primary-500) !important' },
                                            }
                                        }}
                                        sx={{ mb: 3 }}
                                    />
                                )}

                                <Button
                                    fullWidth
                                    type="submit"
                                    variant="contained"
                                    disabled={loading || !passphrase || ((isInit || isMigrate) && !confirmPassphrase)}
                                    sx={{
                                        py: 1.5,
                                        borderRadius: 'var(--n-radius-xl)',
                                        textTransform: 'none',
                                        fontSize: '1.1rem',
                                        fontWeight: 700,
                                        background: 'linear-gradient(135deg, var(--n-primary-500) 0%, var(--n-primary-600) 100%)',
                                        boxShadow: '0 10px 15px -12px rgba(79, 70, 229, 0.4)',
                                        '&:hover': {
                                            background: 'linear-gradient(135deg, var(--n-primary-600) 0%, var(--n-primary-700) 100%)',
                                        },
                                        '&.Mui-disabled': {
                                            background: 'var(--n-bg-surface-alt)',
                                            color: 'var(--n-text-muted)'
                                        }
                                    }}
                                >
                                    {loading ? <CircularProgress size={24} color="inherit" /> : (isMigrate ? 'Migrate to Vault' : isInit ? 'Initialize Vault' : 'Unlock Vault')}
                                </Button>

                                {isUnlock && hasPasskeys && (
                                    <Button
                                        fullWidth
                                        variant="text"
                                        onClick={() => {
                                            setAuthModeOverride('passkey');
                                            setError(null);
                                        }}
                                        disabled={loading}
                                        startIcon={<FingerprintIcon />}
                                        sx={{
                                            mt: 2,
                                            color: 'var(--n-text-secondary)',
                                            textTransform: 'none',
                                            '&:hover': {
                                                color: 'var(--n-text-primary)',
                                                backgroundColor: 'transparent'
                                            }
                                        }}
                                    >
                                        Use passkey instead
                                    </Button>
                                )}
                            </form>

                            <Typography variant="body2" sx={{ color: 'var(--n-text-muted)', mt: 3, textAlign: 'center', fontSize: '0.75rem' }}>
                                Unlocking is only required for syncing and credential management.
                                Data viewing and navigation are fully available.
                            </Typography>
                        </>
                    )}
                </DialogContent>
            </Box>
        </StyledDialog>
    );
};

export default VaultLockScreen;
