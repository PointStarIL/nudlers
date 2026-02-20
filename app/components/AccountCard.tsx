import React from 'react';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    styled,
    alpha,
    Chip,
    Switch,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { CardVendorIcon } from './CardVendorsModal';
import { BANK_VENDORS } from '../utils/constants';

interface CardOwnership {
    id: number;
    vendor: string;
    account_number: string;
    credential_id: number;
    linked_bank_account_id?: number;
    card_nickname?: string;
    bank_account_nickname?: string;
    is_hidden?: boolean;
}

interface Account {
    id: number;
    vendor: string;
    nickname?: string;
    is_active: boolean;
    last_synced_at?: string;
    username?: string;
    id_number?: string;
    card6_digits?: string;
    bank_account_number?: string;
    created_at?: string;
}

interface AccountCardProps {
    account: Account;
    isVaultLocked: boolean;
    ownedCards?: CardOwnership[];
    onEdit: (account: Account) => void;
    onSync: (account: Account) => void;
    onTruncate: (account: Account) => void;
    onDelete: (id: number) => void;
    onToggleActive: (account: Account) => void;
    onToggleCardVisibility?: (cardId: number, isHidden: boolean) => void;
    onUpdateCardLink?: (cardId: number, bankAccountId: number | null) => void;
}

const PremiumCard = styled(Box, {
    shouldForwardProp: (prop) => prop !== 'isBank' && prop !== 'isActive'
})<{ isBank: boolean; isActive: boolean }>(({ theme, isBank, isActive }) => ({
    position: 'relative',
    borderRadius: '24px',
    padding: '24px',
    minHeight: '220px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    overflow: 'hidden',
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'pointer',
    opacity: isActive ? 1 : 0.8,
    background: isBank
        ? 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)'
        : 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
    boxShadow: isActive
        ? `0 10px 30px ${isBank ? 'rgba(14, 165, 233, 0.3)' : 'rgba(30, 41, 59, 0.3)'}`
        : 'none',
    border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
    '&:hover': {
        transform: 'translateY(-8px)',
        boxShadow: `0 20px 40px ${isBank ? 'rgba(14, 165, 233, 0.4)' : 'rgba(30, 41, 59, 0.4)'}`,
        '& .card-actions': {
            opacity: 1,
            transform: 'translateY(0)',
        }
    },
    '&::before': {
        content: '""',
        position: 'absolute',
        top: '-50%',
        right: '-50%',
        width: '100%',
        height: '100%',
        background: alpha(theme.palette.common.white, 0.05),
        borderRadius: '50%',
        pointerEvents: 'none',
    }
}));

const CardActions = styled(Box)({
    position: 'absolute',
    top: '16px',
    right: '16px',
    display: 'flex',
    gap: '8px',
    opacity: 0,
    transform: 'translateY(-10px)',
    transition: 'all 0.3s ease',
    zIndex: 2,
});

const AccountCard: React.FC<AccountCardProps> = ({
    account,
    isVaultLocked,
    ownedCards = [],
    onEdit,
    onSync,
    onTruncate,
    onDelete,
    onToggleActive,
    onToggleCardVisibility,
    onUpdateCardLink
}) => {
    const isBank = BANK_VENDORS.includes(account.vendor);

    const formatLastSync = (dateString?: string) => {
        if (!dateString) return 'Never synced';
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <PremiumCard isBank={isBank} isActive={account.is_active}>
            <CardActions className="card-actions">
                <Tooltip title={isVaultLocked ? "Unlock vault to edit" : "Edit"}>
                    <span>
                        <IconButton
                            size="small"
                            disabled={isVaultLocked}
                            onClick={(e) => { e.stopPropagation(); onEdit(account); }}
                            sx={{
                                color: 'white',
                                bgcolor: alpha('#fff', 0.1),
                                '&:hover': { bgcolor: alpha('#fff', 0.2) },
                                '&.Mui-disabled': { color: alpha('#fff', 0.3), bgcolor: alpha('#fff', 0.05) }
                            }}
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={isVaultLocked ? "Unlock vault to delete history" : "Delete All Data"}>
                    <span>
                        <IconButton
                            size="small"
                            disabled={isVaultLocked}
                            onClick={(e) => { e.stopPropagation(); onTruncate(account); }}
                            sx={{
                                color: 'white',
                                bgcolor: alpha('#fff', 0.1),
                                '&:hover': { bgcolor: alpha('#fff', 0.2) },
                                '&.Mui-disabled': { color: alpha('#fff', 0.3), bgcolor: alpha('#fff', 0.05) }
                            }}
                        >
                            <DeleteSweepIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={isVaultLocked ? "Unlock vault to remove connection" : "Remove"}>
                    <span>
                        <IconButton
                            size="small"
                            disabled={isVaultLocked}
                            onClick={(e) => { e.stopPropagation(); onDelete(account.id); }}
                            sx={{
                                color: 'white',
                                bgcolor: alpha('#fff', 0.1),
                                '&:hover': { bgcolor: alpha('#fff', 0.2) },
                                '&.Mui-disabled': { color: alpha('#fff', 0.3), bgcolor: alpha('#fff', 0.05) }
                            }}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </span>
                </Tooltip>
            </CardActions>

            <Box sx={{ zIndex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <Box sx={{
                        p: 1,
                        borderRadius: '12px',
                        bgcolor: alpha('#fff', 0.15),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <CardVendorIcon vendor={account.vendor} size={24} />
                    </Box>
                    <Box>
                        <Typography variant="h6" sx={{ color: 'white', fontWeight: 700, lineHeight: 1.2 }}>
                            {account.nickname || account.vendor}
                        </Typography>
                        <Typography variant="caption" sx={{ color: alpha('#fff', 0.7), fontWeight: 500 }}>
                            {isBank ? 'Bank Account' : 'Credit Card'}
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ color: alpha('#fff', 0.9), fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '1px' }}>
                        {isBank
                            ? account.bank_account_number || '•••• ••••'
                            : '•••• •••• •••• ••••'}
                    </Typography>
                </Box>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', zIndex: 1 }}>
                <Box>
                    <Typography variant="caption" sx={{ color: alpha('#fff', 0.6), display: 'block', mb: 0.5 }}>
                        Last Synced
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'white', fontWeight: 600 }}>
                        {formatLastSync(account.last_synced_at)}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Switch
                        size="small"
                        checked={account.is_active}
                        onChange={(e) => { e.stopPropagation(); onToggleActive(account); }}
                        sx={{
                            '& .MuiSwitch-switchBase.Mui-checked': { color: '#fff' },
                            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: alpha('#fff', 0.5) }
                        }}
                    />
                    <Tooltip title={isVaultLocked ? "Unlock vault to sync" : "Sync Now"}>
                        <span>
                            <IconButton
                                size="small"
                                disabled={!account.is_active || isVaultLocked}
                                onClick={(e) => { e.stopPropagation(); onSync(account); }}
                                sx={{
                                    color: 'white',
                                    bgcolor: alpha('#fff', 0.2),
                                    '&:hover': { bgcolor: alpha('#fff', 0.3) },
                                    '&.Mui-disabled': { color: alpha('#fff', 0.3), bgcolor: alpha('#fff', 0.05) }
                                }}
                            >
                                <SyncIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </Box>

            {/* Owned Cards Sub-Section */}
            {ownedCards.length > 0 && (
                <Box sx={{
                    mt: 1,
                    pt: 1,
                    borderTop: `1px solid ${alpha('#fff', 0.1)}`,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.75,
                    zIndex: 1,
                }}>
                    {ownedCards.map(card => (
                        <Tooltip key={card.id} title={card.is_hidden
                            ? `${card.account_number.slice(-4)} - Hidden (click to show)`
                            : `${card.account_number.slice(-4)} - Visible (click to hide)`
                        }>
                            <Chip
                                size="small"
                                label={card.account_number.slice(-4)}
                                icon={card.is_hidden
                                    ? <VisibilityOffIcon sx={{ fontSize: '12px !important', color: `${alpha('#fff', 0.4)} !important` }} />
                                    : <VisibilityIcon sx={{ fontSize: '12px !important' }} />
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleCardVisibility?.(card.id, !card.is_hidden);
                                }}
                                sx={{
                                    height: '24px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    ...(card.is_hidden ? {
                                        bgcolor: alpha('#ef5350', 0.25),
                                        color: alpha('#fff', 0.5),
                                        border: `1px solid ${alpha('#ef5350', 0.4)}`,
                                        textDecoration: 'line-through',
                                        '& .MuiChip-icon': { opacity: 0.5 },
                                    } : {
                                        bgcolor: alpha('#66bb6a', 0.3),
                                        color: 'white',
                                        border: `1px solid ${alpha('#66bb6a', 0.5)}`,
                                    }),
                                }}
                            />
                        </Tooltip>
                    ))}
                </Box>
            )}

            {/* Linking Modal/Popover would go here, but for now we keep it simple */}
        </PremiumCard>
    );
};

export default AccountCard;
