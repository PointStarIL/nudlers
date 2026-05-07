import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useTranslation } from 'react-i18next';

import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import VerifiedIcon from '@mui/icons-material/Verified';
import RefreshIcon from '@mui/icons-material/Refresh';

import { logger } from '../utils/client-logger';

type AnomalyType = 'price_hike' | 'new_recurring' | 'category_spike';
type Severity = 'low' | 'medium' | 'high';
type Status = 'open' | 'acknowledged' | 'dismissed' | 'normal';

interface Anomaly {
    id: number;
    type: AnomalyType;
    severity: Severity;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    related_transaction_keys: string[];
    status: Status;
    created_at: string;
}

interface ListResponse {
    anomalies: Anomaly[];
    countByType: Partial<Record<AnomalyType, number>>;
    total: number;
}

const TYPE_META: Record<AnomalyType, { icon: React.ReactNode; tone: string }> = {
    price_hike: { icon: <TrendingUpIcon fontSize="small" />, tone: '#f59e0b' },
    new_recurring: { icon: <AutorenewIcon fontSize="small" />, tone: '#6366f1' },
    category_spike: { icon: <LocalFireDepartmentIcon fontSize="small" />, tone: '#ec4899' },
};

const SEVERITY_TONE: Record<Severity, string> = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: '#94a3b8',
};

const InsightsView: React.FC = () => {
    const { t } = useTranslation(['views', 'common']);

    const [items, setItems] = useState<Anomaly[]>([]);
    const [counts, setCounts] = useState<Partial<Record<AnomalyType, number>>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<AnomalyType | 'all'>('all');
    const [evaluating, setEvaluating] = useState(false);
    const [toast, setToast] = useState<{ severity: 'success' | 'info' | 'error'; message: string } | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const res = await fetch('/api/anomalies?status=open');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ListResponse = await res.json();
            setItems(data.anomalies);
            setCounts(data.countByType);
        } catch (err) {
            logger.error('Failed to load anomalies', err as Error);
            setError(t('views:insights.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { load(); }, [load]);

    const visibleItems = useMemo(
        () => filter === 'all' ? items : items.filter((a) => a.type === filter),
        [items, filter],
    );

    const transition = useCallback(async (id: number, status: 'acknowledged' | 'dismissed' | 'normal') => {
        // Optimistic update — kick the row out of the list immediately, fall back on error.
        const prev = items;
        setItems(items.filter((a) => a.id !== id));
        try {
            const res = await fetch(`/api/anomalies/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (err) {
            logger.error(`Failed to set anomaly ${id} → ${status}`, err as Error);
            setItems(prev); // rollback
            setToast({ severity: 'error', message: 'Action failed — try again' });
        }
    }, [items]);

    const reEvaluate = useCallback(async () => {
        setEvaluating(true);
        try {
            const res = await fetch('/api/anomalies', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setToast({
                severity: 'success',
                message: t('views:insights.evaluatedSummary', {
                    detected: data.detected ?? 0,
                    inserted: data.inserted ?? 0,
                    updated: data.updated ?? 0,
                }),
            });
            await load();
        } catch (err) {
            logger.error('Failed to re-evaluate anomalies', err as Error);
            setToast({ severity: 'error', message: t('views:insights.loadFailed') });
        } finally {
            setEvaluating(false);
        }
    }, [load, t]);

    return (
        <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 980, mx: 'auto' }}>
            <Stack
                direction="row"
                alignItems="flex-end"
                justifyContent="space-between"
                spacing={2}
                sx={{ mb: 3, flexWrap: 'wrap', gap: 1.5 }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2, mb: 0.5 }}>
                        {t('views:insights.title')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('views:insights.subtitle')}
                    </Typography>
                </Box>
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={evaluating ? <CircularProgress size={14} /> : <RefreshIcon />}
                    onClick={reEvaluate}
                    disabled={evaluating}
                >
                    {evaluating ? t('views:insights.evaluating') : t('views:insights.evaluateNow')}
                </Button>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mb: 3 }}>
                <FilterChip
                    label={`${t('views:insights.filterAll')} · ${items.length}`}
                    selected={filter === 'all'}
                    onClick={() => setFilter('all')}
                />
                {(['price_hike', 'new_recurring', 'category_spike'] as AnomalyType[]).map((typ) => {
                    const n = counts[typ] ?? 0;
                    if (n === 0 && filter !== typ) return null;
                    return (
                        <FilterChip
                            key={typ}
                            label={`${t(`views:insights.filter${pascalize(typ)}`)} · ${n}`}
                            selected={filter === typ}
                            onClick={() => setFilter(typ)}
                            tone={TYPE_META[typ].tone}
                            icon={TYPE_META[typ].icon}
                        />
                    );
                })}
            </Stack>

            {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress size={24} />
                </Box>
            )}

            {!loading && error && (
                <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>
            )}

            {!loading && !error && visibleItems.length === 0 && (
                <Box
                    sx={{
                        textAlign: 'center', py: 8, px: 3,
                        background: 'var(--n-bg-surface)',
                        border: '1px solid var(--n-border)',
                        borderRadius: 'var(--n-radius-lg)',
                    }}
                >
                    <CheckIcon sx={{ fontSize: 48, color: '#10b981', mb: 1 }} />
                    <Typography variant="h6" sx={{ mb: 0.5 }}>{t('views:insights.empty')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {t('views:insights.emptyHint')}
                    </Typography>
                </Box>
            )}

            <Stack spacing={1.5}>
                {visibleItems.map((a) => (
                    <AnomalyCard key={a.id} anomaly={a} onTransition={transition} />
                ))}
            </Stack>

            <Snackbar
                open={!!toast}
                autoHideDuration={3500}
                onClose={() => setToast(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                {toast ? <Alert severity={toast.severity} variant="filled">{toast.message}</Alert> : undefined}
            </Snackbar>
        </Box>
    );
};

interface FilterChipProps {
    label: string;
    selected: boolean;
    onClick: () => void;
    tone?: string;
    icon?: React.ReactNode;
}

const FilterChip: React.FC<FilterChipProps> = ({ label, selected, onClick, tone, icon }) => (
    <Chip
        label={label}
        icon={icon as React.ReactElement | undefined}
        onClick={onClick}
        sx={{
            height: 32,
            cursor: 'pointer',
            border: `1px solid ${selected ? (tone || 'var(--n-primary)') : 'var(--n-border)'}`,
            background: selected ? `${tone || 'var(--n-primary)'}22` : 'var(--n-bg-surface)',
            color: 'var(--n-text-primary)',
            fontWeight: selected ? 600 : 500,
            '& .MuiChip-icon': { color: tone || 'inherit' },
        }}
    />
);

interface AnomalyCardProps {
    anomaly: Anomaly;
    onTransition: (id: number, status: 'acknowledged' | 'dismissed' | 'normal') => void;
}

const AnomalyCard: React.FC<AnomalyCardProps> = ({ anomaly, onTransition }) => {
    const { t } = useTranslation(['views']);
    const meta = TYPE_META[anomaly.type];
    const sevTone = SEVERITY_TONE[anomaly.severity];

    return (
        <Box
            sx={{
                position: 'relative',
                p: 2.5,
                background: 'var(--n-bg-surface)',
                border: '1px solid var(--n-border)',
                borderRadius: 'var(--n-radius-lg)',
                transition: 'border-color 0.2s, transform 0.2s',
                '&:hover': {
                    borderColor: meta.tone,
                    transform: 'translateY(-1px)',
                },
                // Subtle severity stripe down the start edge.
                '&::before': {
                    content: '""',
                    position: 'absolute',
                    insetInlineStart: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    background: sevTone,
                    borderStartStartRadius: 'var(--n-radius-lg)',
                    borderEndStartRadius: 'var(--n-radius-lg)',
                },
            }}
        >
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box
                    sx={{
                        width: 36, height: 36, flexShrink: 0,
                        borderRadius: '50%',
                        background: `${meta.tone}22`,
                        color: meta.tone,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                    {meta.icon}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                            {anomaly.title}
                        </Typography>
                        <Chip
                            size="small"
                            label={t(`views:insights.severity${pascalize(anomaly.severity)}`)}
                            sx={{
                                height: 20, fontSize: '0.7rem',
                                background: `${sevTone}22`,
                                color: sevTone,
                                border: `1px solid ${sevTone}66`,
                            }}
                        />
                    </Stack>

                    {anomaly.body && (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.5 }}>
                            {anomaly.body}
                        </Typography>
                    )}

                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        <Button
                            size="small"
                            variant="text"
                            startIcon={<CheckIcon />}
                            onClick={() => onTransition(anomaly.id, 'acknowledged')}
                            sx={{ color: 'var(--n-text-secondary)' }}
                        >
                            {t('views:insights.actionAcknowledge')}
                        </Button>
                        <Button
                            size="small"
                            variant="text"
                            startIcon={<VerifiedIcon />}
                            onClick={() => onTransition(anomaly.id, 'normal')}
                            sx={{ color: 'var(--n-text-secondary)' }}
                        >
                            {t('views:insights.actionNormal')}
                        </Button>
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title={t('views:insights.actionDismiss') as string}>
                            <IconButton
                                size="small"
                                onClick={() => onTransition(anomaly.id, 'dismissed')}
                                aria-label={t('views:insights.actionDismiss') as string}
                            >
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
};

function pascalize(s: string): string {
    return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

export default InsightsView;
