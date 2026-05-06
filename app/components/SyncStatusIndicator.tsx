import React, { useEffect } from 'react';
import { logger } from '../utils/client-logger';
import { Box, Tooltip, Typography } from '@mui/material';
import { styled, keyframes, useTheme } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import SyncIcon from '@mui/icons-material/Sync';
import SyncDisabledIcon from '@mui/icons-material/SyncDisabled';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../context/LocaleContext';

interface SyncStatus {
  syncHealth: string;
  settings: {
    enabled: boolean;
    syncHour: number;
    daysBack: number;
  };
  activeAccounts: number;
  latestScrape: {
    triggered_by: string;
    vendor: string;
    status: string;
    created_at: string;
  } | null;
  accountSyncStatus: Array<{
    id: number;
    nickname: string;
    vendor: string;
    last_synced_at: string | null;
  }>;
}

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
  gap: '6px',
  padding: '4px 10px',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s ease-in-out',
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)',
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
    transform: 'translateY(-1px)',
  },
}));

// Helper function to parse date strings from API (now returns ISO strings with timezone)
const parseDate = (dateStr: string | null): Date => {
  if (!dateStr) return new Date();

  // API should return ISO strings (e.g., "2026-01-29T10:30:00.000Z")
  // But handle edge cases where it might not be properly formatted
  let date: Date;

  // If it already has 'Z' or timezone offset, parse directly
  if (dateStr.includes('Z') || dateStr.match(/[+-]\d{2}:?\d{2}$/)) {
    date = new Date(dateStr);
  }
  // If it's PostgreSQL format without timezone (shouldn't happen but handle it)
  else if (dateStr.match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/)) {
    // Treat as UTC by appending 'Z'
    const isoStr = dateStr.replace(' ', 'T').replace(/\.(\d+)?$/, (match, millis) => {
      return millis ? `.${millis.padEnd(3, '0')}` : '.000';
    }) + (dateStr.includes('.') ? '' : '.000') + 'Z';
    date = new Date(isoStr);
  }
  // Try parsing as-is
  else {
    date = new Date(dateStr);
  }

  // Validate the date is valid
  if (isNaN(date.getTime())) {
    logger.warn(`Invalid date string: ${dateStr}`);
    return new Date();
  }

  return date;
};

import { useStatus } from '../context/StatusContext';

interface SyncStatusIndicatorProps {
  onClick?: () => void;
}

const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({ onClick }) => {
  const { syncStatus: status } = useStatus();
  const theme = useTheme();
  const { t } = useTranslation(['sync', 'common']);
  const { locale } = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';

  const formatRelativeTime = (dateStr: string) => {
    const date = parseDate(dateStr);
    const now = new Date();

    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMs < 0) {
      const absDiffMins = Math.abs(diffMins);
      if (absDiffMins < 1) return t('sync:relativeTimeShort.justNow');
      if (absDiffMins < 60) return t('sync:relativeTimeShort.inMinutes', { count: absDiffMins });
      return t('sync:relativeTimeShort.justNow');
    }

    if (diffMins < 1) return t('sync:relativeTimeShort.justNow');
    if (diffMins < 60) return t('sync:relativeTimeShort.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('sync:relativeTimeShort.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('sync:relativeTimeShort.daysAgo', { count: diffDays });
    return date.toLocaleDateString(dateLocale);
  };

  // Update browser tab title based on sync status
  useEffect(() => {
    const originalTitle = 'Nudlers';
    if (status?.syncHealth === 'syncing') {
      document.title = t('sync:indicator.tabSyncing', { title: originalTitle });
    } else {
      document.title = originalTitle;
    }
    return () => {
      document.title = originalTitle;
    };
  }, [status?.syncHealth, t]);

  if (!status) {
    return null;
  }

  const getStatusInfo = () => {
    const health = status.syncHealth;
    const oldestSyncDate = status.summary?.oldest_sync_at ? new Date(status.summary.oldest_sync_at) : null;

    const isDark = theme.palette.mode === 'dark';

    const oldestRelative = oldestSyncDate
      ? formatRelativeTime(oldestSyncDate.toISOString())
      : t('sync:indicator.healthy.unknownTime');

    switch (health) {
      case 'healthy':
        return {
          icon: <CheckCircleIcon sx={{ fontSize: 18, color: isDark ? '#4ADE80' : '#059669' }} />,
          label: t('sync:indicator.healthy.label'),
          color: isDark ? '#4ADE80' : '#059669',
          tooltip: t('sync:indicator.healthy.tooltip', { time: oldestRelative })
        };
      case 'syncing':
        return {
          icon: <SyncIcon sx={{ fontSize: 18, color: isDark ? '#60A5FA' : '#2563EB', animation: `${spin} 2s linear infinite` }} />,
          label: t('sync:indicator.syncing.label'),
          color: isDark ? '#60A5FA' : '#2563EB',
          tooltip: t('sync:indicator.syncing.tooltip')
        };
      case 'error':
        return {
          icon: <ErrorIcon sx={{ fontSize: 18, color: isDark ? '#F87171' : '#DC2626', animation: `${pulse} 2s ease-in-out infinite` }} />,
          label: t('sync:indicator.error.label'),
          color: isDark ? '#F87171' : '#DC2626',
          tooltip: t('sync:indicator.error.tooltip')
        };
      case 'stale':
        return {
          icon: <WarningIcon sx={{ fontSize: 18, color: isDark ? '#FBBF24' : '#D97706' }} />,
          label: t('sync:indicator.stale.label'),
          color: isDark ? '#FBBF24' : '#D97706',
          tooltip: t('sync:indicator.stale.tooltip', { time: oldestRelative })
        };
      case 'outdated':
        return {
          icon: <WarningIcon sx={{ fontSize: 18, color: isDark ? '#FBBF24' : '#D97706' }} />,
          label: t('sync:indicator.outdated.label'),
          color: isDark ? '#FBBF24' : '#D97706',
          tooltip: t('sync:indicator.outdated.tooltip', { time: oldestRelative })
        };
      case 'no_accounts':
        return {
          icon: <SyncDisabledIcon sx={{ fontSize: 18, color: isDark ? '#94A3B8' : '#64748B' }} />,
          label: t('sync:indicator.noAccounts.label'),
          color: isDark ? '#94A3B8' : '#64748B',
          tooltip: t('sync:indicator.noAccounts.tooltip')
        };
      case 'never_synced':
        return {
          icon: <SyncIcon sx={{ fontSize: 18, color: isDark ? '#FBBF24' : '#D97706' }} />,
          label: t('sync:indicator.neverSynced.label'),
          color: isDark ? '#FBBF24' : '#D97706',
          tooltip: t('sync:indicator.neverSynced.tooltip')
        };
      default:
        return {
          icon: <CloudOffIcon sx={{ fontSize: 18, color: isDark ? '#94A3B8' : '#64748B' }} />,
          label: t('sync:indicator.unknown.label'),
          color: isDark ? '#94A3B8' : '#64748B',
          tooltip: t('sync:indicator.unknown.tooltip')
        };
    }
  };

  const statusInfo = getStatusInfo();

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
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {statusInfo.label}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.9 }}>
            {statusInfo.tooltip}
          </Typography>
          {status && (
            <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', opacity: 0.7, mt: 0.5 }}>
              {t('sync:indicator.activeAccounts', { count: status.activeAccounts })}
            </Typography>
          )}
        </Box>
      }
      arrow
    >
      <StatusContainer onClick={handleClick} role="button" tabIndex={0}>
        {statusInfo.icon}
        <Typography
          variant="caption"
          sx={{
            color: statusInfo.color,
            fontWeight: 500,
            display: { xs: 'none', sm: 'block' }
          }}
        >
          {statusInfo.label}
        </Typography>
      </StatusContainer>
    </Tooltip>
  );
};

export default SyncStatusIndicator;
