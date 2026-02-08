import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { styled, keyframes, useTheme } from '@mui/material/styles';
import StorageIcon from '@mui/icons-material/Storage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import SyncIcon from '@mui/icons-material/Sync';
import SyncDisabledIcon from '@mui/icons-material/SyncDisabled';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useStatus } from '../context/StatusContext';

const spin = keyframes`
  0% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
`;

const StatusContainer = styled(Box)(({ theme }) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 12px',
    borderRadius: '20px',
    cursor: 'pointer',
    transition: 'all 0.2s ease-in-out',
    backgroundColor: theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.05)'
        : 'rgba(0, 0, 0, 0.05)',
    border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
    '&:hover': {
        backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.1)'
            : 'rgba(0, 0, 0, 0.08)',
        transform: 'translateY(-1px)',
        boxShadow: theme.palette.mode === 'dark'
            ? '0 4px 12px rgba(0, 0, 0, 0.3)'
            : '0 4px 12px rgba(0, 0, 0, 0.1)',
    },
}));

const DatabaseSection = styled(Box)({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
});

const StatusDot = styled('div')<{ connected: boolean }>(({ connected }) => ({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: connected ? '#10B981' : '#EF4444',
    position: 'relative',
    '&::after': {
        content: '""',
        position: 'absolute',
        top: -1,
        left: -1,
        right: -1,
        bottom: -1,
        borderRadius: '50%',
        backgroundColor: connected ? '#10B981' : '#EF4444',
        opacity: 0.4,
        animation: connected ? 'pulse 2s infinite' : 'none',
    },
    '@keyframes pulse': {
        '0%': { transform: 'scale(1)', opacity: 0.4 },
        '70%': { transform: 'scale(2)', opacity: 0 },
        '100%': { transform: 'scale(1)', opacity: 0 },
    },
}));

const Divider = styled('div')(({ theme }) => ({
    width: '1px',
    height: '16px',
    backgroundColor: theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.15)'
        : 'rgba(0, 0, 0, 0.15)',
}));

const SyncSection = styled(Box)({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
});

// Helper function to format relative time
const formatRelativeTime = (dateStr: string) => {
    // Parse date - API returns ISO strings
    let date: Date;
    if (dateStr.includes('Z') || dateStr.match(/[+-]\d{2}:?\d{2}$/)) {
        date = new Date(dateStr);
    } else if (dateStr.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/)) {
        const isoStr = dateStr.replace(' ', 'T').replace(/\.(\d+)?$/, (match, millis) => {
            return millis ? `.${millis.padEnd(3, '0')}` : '.000';
        }) + (dateStr.includes('.') ? '' : '.000') + 'Z';
        date = new Date(isoStr);
    } else {
        date = new Date(dateStr);
    }

    if (isNaN(date.getTime())) {
        return 'Unknown';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMs < 0) {
        const absDiffMins = Math.abs(diffMins);
        if (absDiffMins < 1) return 'just now';
        if (absDiffMins < 60) return `in ${absDiffMins}m`;
        return 'just now';
    }

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

interface CombinedStatusIndicatorProps {
    onClick?: () => void;
}

const CombinedStatusIndicator: React.FC<CombinedStatusIndicatorProps> = ({ onClick }) => {
    const { isDbConnected, syncStatus } = useStatus();
    const theme = useTheme();

    // Update browser tab title based on sync status
    React.useEffect(() => {
        const originalTitle = 'Nudlers';
        if (syncStatus?.syncHealth === 'syncing') {
            document.title = `(Syncing...) ${originalTitle}`;
        } else {
            document.title = originalTitle;
        }
        return () => {
            document.title = originalTitle;
        };
    }, [syncStatus?.syncHealth]);

    const getSyncStatusInfo = () => {
        if (!syncStatus) {
            return {
                icon: <CloudOffIcon sx={{ fontSize: 16, color: theme.palette.mode === 'dark' ? '#94A3B8' : '#64748B' }} />,
                label: 'Unknown',
                color: theme.palette.mode === 'dark' ? '#94A3B8' : '#64748B',
                tooltip: 'Sync status unknown'
            };
        }

        const health = syncStatus.syncHealth;
        const oldestSyncDate = syncStatus.summary?.oldest_sync_at ? new Date(syncStatus.summary.oldest_sync_at) : null;
        const isDark = theme.palette.mode === 'dark';

        switch (health) {
            case 'healthy':
                return {
                    icon: <CheckCircleIcon sx={{ fontSize: 16, color: isDark ? '#4ADE80' : '#059669' }} />,
                    label: 'Healthy',
                    color: isDark ? '#4ADE80' : '#059669',
                    tooltip: `All accounts synced. Last: ${oldestSyncDate ? formatRelativeTime(oldestSyncDate.toISOString()) : 'Unknown'}`
                };
            case 'syncing':
                return {
                    icon: <SyncIcon sx={{ fontSize: 16, color: isDark ? '#60A5FA' : '#2563EB', animation: `${spin} 2s linear infinite` }} />,
                    label: 'Syncing',
                    color: isDark ? '#60A5FA' : '#2563EB',
                    tooltip: 'Sync in progress...'
                };
            case 'error':
                return {
                    icon: <ErrorIcon sx={{ fontSize: 16, color: isDark ? '#F87171' : '#DC2626', animation: `${pulse} 2s ease-in-out infinite` }} />,
                    label: 'Error',
                    color: isDark ? '#F87171' : '#DC2626',
                    tooltip: 'Last sync failed. Check status for details.'
                };
            case 'stale':
                return {
                    icon: <WarningIcon sx={{ fontSize: 16, color: isDark ? '#FBBF24' : '#D97706' }} />,
                    label: 'Stale',
                    color: isDark ? '#FBBF24' : '#D97706',
                    tooltip: `Some accounts need sync. Oldest: ${oldestSyncDate ? formatRelativeTime(oldestSyncDate.toISOString()) : 'Unknown'}`
                };
            case 'outdated':
                return {
                    icon: <WarningIcon sx={{ fontSize: 16, color: isDark ? '#FBBF24' : '#D97706' }} />,
                    label: 'Outdated',
                    color: isDark ? '#FBBF24' : '#D97706',
                    tooltip: `Accounts haven't synced in a while. Oldest: ${oldestSyncDate ? formatRelativeTime(oldestSyncDate.toISOString()) : 'Unknown'}`
                };
            case 'no_accounts':
                return {
                    icon: <SyncDisabledIcon sx={{ fontSize: 16, color: isDark ? '#94A3B8' : '#64748B' }} />,
                    label: 'No Accounts',
                    color: isDark ? '#94A3B8' : '#64748B',
                    tooltip: 'Add accounts to start syncing'
                };
            case 'never_synced':
                return {
                    icon: <SyncIcon sx={{ fontSize: 16, color: isDark ? '#FBBF24' : '#D97706' }} />,
                    label: 'Never Synced',
                    color: isDark ? '#FBBF24' : '#D97706',
                    tooltip: 'Accounts have never been synced.'
                };
            default:
                return {
                    icon: <CloudOffIcon sx={{ fontSize: 16, color: isDark ? '#94A3B8' : '#64748B' }} />,
                    label: 'Unknown',
                    color: isDark ? '#94A3B8' : '#64748B',
                    tooltip: 'Sync status unknown'
                };
        }
    };

    const syncInfo = getSyncStatusInfo();

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (onClick) {
            onClick();
        }
    };

    return (
        <Tooltip
            title={
                <Box sx={{ p: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <StorageIcon sx={{ fontSize: 14 }} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            Database: {isDbConnected ? 'Connected' : 'Disconnected'}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {syncInfo.icon}
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            Sync: {syncInfo.label}
                        </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.9, display: 'block', mt: 0.5 }}>
                        {syncInfo.tooltip}
                    </Typography>
                    {syncStatus && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', opacity: 0.7, mt: 0.5 }}>
                            {syncStatus.activeAccounts} active account{syncStatus.activeAccounts !== 1 ? 's' : ''}
                        </Typography>
                    )}
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', opacity: 0.5, mt: 1, fontStyle: 'italic' }}>
                        Click to open sync panel
                    </Typography>
                </Box>
            }
            arrow
        >
            <StatusContainer onClick={handleClick} role="button" tabIndex={0}>
                {/* Database Status Section */}
                <DatabaseSection>
                    <StorageIcon
                        sx={{
                            fontSize: '14px',
                            color: theme.palette.mode === 'dark' ? '#94A3B8' : '#64748B'
                        }}
                    />
                    <StatusDot connected={isDbConnected} />
                </DatabaseSection>

                {/* Divider */}
                <Divider />

                {/* Sync Status Section */}
                <SyncSection>
                    {syncInfo.icon}
                    <Typography
                        variant="caption"
                        sx={{
                            color: syncInfo.color,
                            fontWeight: 500,
                            fontSize: '0.75rem',
                            display: { xs: 'none', sm: 'block' }
                        }}
                    >
                        {syncInfo.label}
                    </Typography>
                </SyncSection>
            </StatusContainer>
        </Tooltip>
    );
};

export default CombinedStatusIndicator;
