import React from 'react';
import { logger } from '../../../utils/client-logger';
import { useTheme } from '@mui/material/styles';
import { Table, TableBody, TableCell, TableHead, TableRow, Paper, Box, Typography, IconButton, TextField, Autocomplete, Snackbar, Alert, FormControlLabel, Checkbox, Tooltip, TableSortLabel, useMediaQuery, Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { formatNumber } from '../utils/formatUtils';
import { dateUtils } from '../utils/dateUtils';
import { useCategories } from '../utils/useCategories';
import { useCardVendors } from '../utils/useCardVendors';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import NotesIcon from '@mui/icons-material/Notes';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { CardVendorIcon } from '../../CardVendorsModal';
import { getTableHeaderCellStyle, getTableBodyCellStyle, TABLE_ROW_HOVER_STYLE, getTableRowHoverBackground } from '../utils/tableStyles';
import DeleteConfirmationDialog from '../../DeleteConfirmationDialog';
import CategoryAutocomplete from '../../CategoryAutocomplete';
import AccountDisplay from '../../AccountDisplay';
import MobileSortableTable, { SortOption } from '../../MobileSortableTable';
import { Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../context/LocaleContext';

const getCurrencySymbol = (currency?: string) => {
  if (!currency) return '₪';
  if (['EUR', '€'].includes(currency)) return '€';
  if (['USD', '$'].includes(currency)) return '$';
  if (['GBP', '£'].includes(currency)) return '£';
  if (['ILS', '₪', 'NIS'].includes(currency)) return '₪';
  return currency + ' ';
};

export interface Transaction {
  name: string;
  price: number;
  date: string;
  category: string;
  identifier: string;
  vendor: string;
  installments_number?: number;
  installments_total?: number;
  vendor_nickname?: string;
  original_amount?: number;
  original_currency?: string;
  charged_currency?: string;
  account_number?: string;
  processed_date?: string;
  is_favorite?: boolean;
  notes?: string;
}

export interface TransactionsTableProps {
  transactions: Transaction[];
  isLoading?: boolean;
  onDelete?: (transaction: Transaction) => void;
  onUpdate?: (transaction: Transaction, updates: Partial<Transaction>) => void;
  groupByDate?: boolean;
  disableWrapper?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  hideActions?: boolean;
  hideInstallmentsColumn?: boolean;
  showProcessedDate?: boolean;
  isBankView?: boolean;
}

const TransactionsTable: React.FC<TransactionsTableProps> = ({
  transactions,
  isLoading,
  onDelete,
  onUpdate,
  groupByDate,
  disableWrapper,
  sortBy,
  sortOrder,
  onSort,
  hideActions,
  hideInstallmentsColumn,
  showProcessedDate = false,
  isBankView = false
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['tx', 'common']);
  const { locale } = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [editingTransaction, setEditingTransaction] = React.useState<Transaction | null>(null);
  const [editPrice, setEditPrice] = React.useState<string>('');
  const [editCategory, setEditCategory] = React.useState<string>('');
  const [applyToAll, setApplyToAll] = React.useState<boolean>(false);
  const { categories: availableCategories } = useCategories();
  const { getCardVendor, getCardNickname } = useCardVendors();
  const [snackbar, setSnackbar] = React.useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success'
  });
  const [confirmDeleteTransaction, setConfirmDeleteTransaction] = React.useState<Transaction | null>(null);
  const [editingNotes, setEditingNotes] = React.useState<{ identifier: string; vendor: string; content: string } | null>(null);

  const handleToggleFavorite = React.useCallback(async (transaction: Transaction) => {
    try {
      const newStatus = !transaction.is_favorite;
      onUpdate?.(transaction, { is_favorite: newStatus });
    } catch (error) {
      logger.error('Error toggling favorite', error as Error);
    }
  }, [onUpdate]);

  const handleNotesUpdate = React.useCallback(async (transaction: Transaction, notes: string) => {
    try {
      onUpdate?.(transaction, { notes });
      setEditingNotes(null);
    } catch (error) {
      logger.error('Error updating notes', error as Error);
    }
  }, [onUpdate]);

  const handleDeleteClick = React.useCallback(() => {
    if (!confirmDeleteTransaction) return;
    try {
      onDelete?.(confirmDeleteTransaction);
      setSnackbar({ open: true, message: t('tx:snackbar.deleteSuccess'), severity: 'success' });
    } catch (error) {
      logger.error('Error deleting transaction', error as Error);
      setSnackbar({ open: true, message: t('tx:snackbar.deleteError'), severity: 'error' });
    }
    setConfirmDeleteTransaction(null);
  }, [confirmDeleteTransaction, onDelete]);

  const handleEditClick = React.useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditPrice(Math.abs(transaction.price).toString());
    setEditCategory(transaction.category);
    setApplyToAll(false);
  }, []);

  const handleSaveClick = React.useCallback(async () => {
    if (editingTransaction && editPrice) {
      const newPrice = parseFloat(editPrice);
      if (!isNaN(newPrice)) {
        const sign = isBankView ? (editingTransaction.price >= 0 ? 1 : -1) : (editingTransaction.price < 0 ? -1 : 1);
        const priceWithSign = sign * newPrice;
        const categoryChanged = editCategory !== editingTransaction.category;
        const priceChanged = priceWithSign !== editingTransaction.price;

        try {
          if (categoryChanged) {
            if (applyToAll) {
              const response = await fetch('/api/categories/update-by-description', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  description: editingTransaction.name,
                  newCategory: editCategory,
                  createRule: true
                }),
              });

              if (response.ok) {
                const result = await response.json();
                setSnackbar({
                  open: true,
                  message: result.transactionsUpdated > 1
                    ? t('tx:snackbar.updatedManyAndRule', { count: result.transactionsUpdated })
                    : t('tx:snackbar.categoryUpdatedAndRule'),
                  severity: 'success'
                });
                onUpdate?.(editingTransaction, { category: editCategory, price: priceWithSign });
                window.dispatchEvent(new CustomEvent('dataRefresh'));
              }
            } else {
              onUpdate?.(editingTransaction, { category: editCategory, price: priceWithSign });
            }
          } else if (priceChanged) {
            onUpdate?.(editingTransaction, { price: priceWithSign });
          }
        } catch (error) {
          logger.error('Error updating transaction', error as Error);
          setSnackbar({ open: true, message: t('tx:snackbar.updateError'), severity: 'error' });
        }
        setEditingTransaction(null);
      }
    }
  }, [editingTransaction, editPrice, editCategory, applyToAll, onUpdate, isBankView]);

  const handleCancelClick = React.useCallback(() => {
    setEditingTransaction(null);
  }, []);

  const handleRowClick = React.useCallback((transaction: Transaction) => {
    if (editingTransaction && (editingTransaction.identifier !== transaction.identifier || editingTransaction.vendor !== transaction.vendor)) {
      handleSaveClick();
    }
  }, [editingTransaction, handleSaveClick]);

  const handleTableClick = React.useCallback((e: React.MouseEvent) => {
    if (editingTransaction && (e.target as HTMLElement).tagName === 'TABLE') {
      handleSaveClick();
    }
  }, [editingTransaction, handleSaveClick]);

  const groupedTransactions = React.useMemo(() => {
    if (!groupByDate) return { 'all': transactions };
    const groups: { [date: string]: Transaction[] } = {};
    transactions.forEach(transaction => {
      const d = new Date(transaction.date);
      const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(transaction);
    });
    return groups;
  }, [transactions, groupByDate]);

  const sortedDates = React.useMemo(() => {
    if (!groupByDate) return [];
    return Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));
  }, [groupedTransactions, groupByDate]);

  const formatDateHeader = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getTime() === today.getTime()) return t('tx:groupHeader.today');
    if (date.getTime() === yesterday.getTime()) return t('tx:groupHeader.yesterday');
    return date.toLocaleDateString(dateLocale, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const mobileSortOptions: SortOption[] = React.useMemo(() => [
    { id: 'date', label: t('tx:table.sortByDate'), defaultDirection: 'desc' },
    { id: 'price', label: t('tx:table.sortByAmount'), defaultDirection: 'desc' },
    { id: 'name', label: t('tx:table.sortByName'), defaultDirection: 'asc' },
    { id: 'category', label: t('tx:table.sortByCategory'), defaultDirection: 'asc' },
  ], [t]);

  const handleMobileSort = React.useCallback((field: string) => {
    if (onSort) onSort(field);
  }, [onSort]);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><Typography>{t('tx:table.loading')}</Typography></Box>;
  if (!transactions || transactions.length === 0) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><Typography>{t('tx:table.empty')}</Typography></Box>;

  const columnWidths = { description: '35%', category: '15%', amount: '12%', installment: '8%', card: '12%', date: '10%', actions: '8%' };
  const tableHeaderBaseStyle = getTableHeaderCellStyle(theme);

  const renderSortableHeader = (label: string, field: string, align: 'left' | 'right' = 'left', width?: string) => {
    const isSorted = sortBy === field;
    return (
      <TableCell align={align} style={{ ...tableHeaderBaseStyle, cursor: 'pointer', position: 'sticky', top: 0, zIndex: 10, width }} sortDirection={isSorted ? sortOrder : false}>
        {onSort ? (
          <TableSortLabel active={isSorted} direction={isSorted ? sortOrder : 'desc'} onClick={() => onSort(field)}>
            {label}
          </TableSortLabel>
        ) : label}
      </TableCell>
    );
  };

  const content = (
    <Box sx={{ width: '100%' }}>
      {isMobile ? (
        <MobileSortableTable
          sortOptions={mobileSortOptions}
          rows={transactions}
          loading={isLoading}
          sortField={sortBy || 'date'}
          sortDirection={sortOrder || 'desc'}
          onSort={handleMobileSort}
          rowKey={(t) => `${t.identifier}-${t.vendor}`}
          renderCard={(t) => (
            <TransactionMobileCardContent
              transaction={t}
              theme={theme}
              onEdit={() => handleEditClick(t)}
              onDelete={() => setConfirmDeleteTransaction(t)}
              onToggleFavorite={() => handleToggleFavorite(t)}
              onNotesUpdate={(notes) => handleNotesUpdate(t, notes)}
              getCardVendor={getCardVendor}
              getCardNickname={getCardNickname}
              showDate={!groupByDate}
              isEditing={editingTransaction?.identifier === t.identifier}
              editCategory={editCategory}
              setEditCategory={setEditCategory}
              availableCategories={availableCategories}
              applyToAll={applyToAll}
              setApplyToAll={setApplyToAll}
              editPrice={editPrice}
              setEditPrice={setEditPrice}
              onSave={handleSaveClick}
              onCancel={handleCancelClick}
            />
          )}
        />
      ) : (
        <Table size={disableWrapper ? "small" : "medium"} stickyHeader>
          <TableHead>
            <TableRow>
              {renderSortableHeader(t('tx:table.columnDescription'), 'name', 'left', columnWidths.description)}
              {renderSortableHeader(t('tx:table.columnCategory'), 'category', 'left', columnWidths.category)}
              {renderSortableHeader(t('tx:table.columnAmount'), 'price', 'right', columnWidths.amount)}
              {!hideInstallmentsColumn && <TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.installment }}>{t('tx:table.columnInstallments')}</TableCell>}
              {renderSortableHeader(t('tx:table.columnCard'), 'account_number', 'left', columnWidths.card)}
              {!groupByDate && renderSortableHeader(t('tx:table.columnDate'), 'date', 'left', columnWidths.date)}
              {!hideActions && <TableCell align="right" style={{ ...tableHeaderBaseStyle, width: columnWidths.actions }}>{t('tx:table.columnActions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {groupByDate ? sortedDates.map(date => (
              <React.Fragment key={date}>
                <TableRow sx={{ background: theme.palette.mode === 'dark' ? 'rgba(30, 41, 59, 1)' : '#f8fafc', position: 'sticky', top: 53, zIndex: 9 }}>
                  <TableCell colSpan={7} sx={{ fontWeight: 700, p: 1 }}>{formatDateHeader(date)}</TableCell>
                </TableRow>
                {groupedTransactions[date].map((t, i) => (
                  <TransactionRow
                    key={`${t.identifier}-${i}`}
                    transaction={t}
                    theme={theme}
                    editingTransaction={editingTransaction}
                    editCategory={editCategory}
                    setEditCategory={setEditCategory}
                    availableCategories={availableCategories}
                    applyToAll={applyToAll}
                    setApplyToAll={setApplyToAll}
                    handleRowClick={handleRowClick}
                    handleEditClick={handleEditClick}
                    editPrice={editPrice}
                    setEditPrice={setEditPrice}
                    handleSaveClick={handleSaveClick}
                    handleCancelClick={handleCancelClick}
                    setConfirmDeleteTransaction={setConfirmDeleteTransaction}
                    onToggleFavorite={handleToggleFavorite}
                    onNotesUpdate={handleNotesUpdate}
                    editingNotes={editingNotes}
                    setEditingNotes={setEditingNotes}
                    getCardVendor={getCardVendor}
                    getCardNickname={getCardNickname}
                    isWidget={disableWrapper}
                    hideActions={hideActions}
                    hideInstallmentsColumn={hideInstallmentsColumn}
                    showProcessedDate={showProcessedDate}
                    groupByDate={true}
                  />
                ))}
              </React.Fragment>
            )) : transactions.map((t, i) => (
              <TransactionRow
                key={i}
                transaction={t}
                theme={theme}
                editingTransaction={editingTransaction}
                editCategory={editCategory}
                setEditCategory={setEditCategory}
                availableCategories={availableCategories}
                applyToAll={applyToAll}
                setApplyToAll={setApplyToAll}
                handleRowClick={handleRowClick}
                handleEditClick={handleEditClick}
                editPrice={editPrice}
                setEditPrice={setEditPrice}
                handleSaveClick={handleSaveClick}
                handleCancelClick={handleCancelClick}
                setConfirmDeleteTransaction={setConfirmDeleteTransaction}
                onToggleFavorite={handleToggleFavorite}
                onNotesUpdate={handleNotesUpdate}
                editingNotes={editingNotes}
                setEditingNotes={setEditingNotes}
                getCardVendor={getCardVendor}
                getCardNickname={getCardNickname}
                isWidget={disableWrapper}
                hideActions={hideActions}
                hideInstallmentsColumn={hideInstallmentsColumn}
                showProcessedDate={showProcessedDate}
                isBankView={isBankView}
                groupByDate={false}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })}>{snackbar.message}</Alert>
      </Snackbar>
      <DeleteConfirmationDialog
        open={!!confirmDeleteTransaction}
        onClose={() => setConfirmDeleteTransaction(null)}
        onConfirm={handleDeleteClick}
        transaction={confirmDeleteTransaction}
      />
    </Box>
  );

  return disableWrapper ? content : <Paper elevation={0} sx={{ p: 2, borderRadius: '16px' }}>{content}</Paper>;
};

interface TransactionRowProps {
  transaction: Transaction;
  theme: Theme;
  editingTransaction: Transaction | null;
  editCategory: string;
  setEditCategory: (val: string) => void;
  availableCategories: string[];
  applyToAll: boolean;
  setApplyToAll: (val: boolean) => void;
  handleRowClick: (t: Transaction) => void;
  handleEditClick: (t: Transaction) => void;
  editPrice: string;
  setEditPrice: (val: string) => void;
  handleSaveClick: () => void;
  handleCancelClick: () => void;
  setConfirmDeleteTransaction: (t: Transaction) => void;
  getCardVendor: (accountNumber: string | undefined | null) => string | null;
  getCardNickname: (accountNumber: string | undefined | null) => string | null | undefined;
  onToggleFavorite: (t: Transaction) => void;
  onNotesUpdate: (t: Transaction, notes: string) => void;
  editingNotes: { identifier: string; vendor: string; content: string } | null;
  setEditingNotes: (val: { identifier: string; vendor: string; content: string } | null) => void;
  isWidget?: boolean;
  hideActions?: boolean;
  hideInstallmentsColumn?: boolean;
  showProcessedDate?: boolean;
  isBankView?: boolean;
  groupByDate?: boolean;
}

const TransactionRow = React.memo(({
  transaction,
  theme,
  editingTransaction,
  editCategory,
  setEditCategory,
  availableCategories,
  applyToAll,
  setApplyToAll,
  handleRowClick,
  handleEditClick,
  editPrice,
  setEditPrice,
  handleSaveClick,
  handleCancelClick,
  setConfirmDeleteTransaction,
  getCardVendor,
  getCardNickname,
  onToggleFavorite,
  onNotesUpdate,
  editingNotes,
  setEditingNotes,
  isWidget,
  hideActions,
  hideInstallmentsColumn,
  showProcessedDate,
  isBankView,
  groupByDate
}: TransactionRowProps) => {
  const { t } = useTranslation(['tx', 'common']);
  const cellStyle = { ...getTableBodyCellStyle(theme), fontSize: isWidget ? '0.75rem' : '0.875rem', p: isWidget ? '4px 12px' : '8px 16px' };

  return (
    <TableRow onClick={() => handleRowClick(transaction)} style={TABLE_ROW_HOVER_STYLE} onMouseEnter={(e) => e.currentTarget.style.background = getTableRowHoverBackground(theme)} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <TableCell style={{ ...cellStyle, maxWidth: '300px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={transaction.is_favorite ? t('tx:tooltips.unfavorite') : t('tx:tooltips.favorite')}>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(transaction); }}
              sx={{
                color: transaction.is_favorite ? '#fbbf24' : theme.palette.text.disabled,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                p: '4px',
                '&:hover': {
                  transform: 'scale(1.2) rotate(5deg)',
                  color: '#fbbf24',
                  background: 'rgba(251, 191, 36, 0.08)'
                },
                '& svg': {
                  filter: transaction.is_favorite ? 'drop-shadow(0 0 2px rgba(251, 191, 36, 0.4))' : 'none'
                }
              }}
            >
              {transaction.is_favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{transaction.name}</Typography>
            {transaction.notes && (
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontStyle: 'italic',
                  fontSize: '0.7rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  mt: 0.25
                }}
                noWrap
              >
                <NotesIcon sx={{ fontSize: '0.75rem', opacity: 0.7 }} />
                {transaction.notes}
              </Typography>
            )}
          </Box>
        </Box>
      </TableCell>
      <TableCell style={cellStyle}>
        {editingTransaction?.identifier === transaction.identifier && !hideActions ? (
          <CategoryAutocomplete value={editCategory} onChange={setEditCategory} options={availableCategories} applyToAll={applyToAll} onApplyToAllChange={setApplyToAll} showApplyToAll={editCategory !== editingTransaction.category} />
        ) : <span style={{ cursor: 'pointer', color: '#3b82f6' }} onClick={(e) => { e.stopPropagation(); handleEditClick(transaction); }}>{transaction.category}</span>}
      </TableCell>
      <TableCell align="right" style={{
        ...cellStyle,
        color: transaction.price < 0 ? '#ef4444' : '#10b981',
        fontWeight: 600
      }}>
        {editingTransaction?.identifier === transaction.identifier && !hideActions ? (
          <TextField value={editPrice} onChange={(e) => setEditPrice(e.target.value)} size="small" type="number" sx={{ width: '80px' }} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span>{isBankView && transaction.price >= 0 ? '+' : ''}₪{formatNumber(Math.abs(transaction.price))}</span>
            {transaction.original_currency && !['ILS', '₪', 'NIS'].includes(transaction.original_currency) && transaction.original_amount && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                ({getCurrencySymbol(transaction.original_currency)}{formatNumber(Math.abs(transaction.original_amount))})
              </Typography>
            )}
          </Box>
        )}
      </TableCell>
      {!hideInstallmentsColumn && (
        <TableCell align="center" style={cellStyle}>
          {transaction.installments_total && transaction.installments_total > 1 ? `${transaction.installments_number}/${transaction.installments_total}` : '—'}
        </TableCell>
      )}
      <TableCell style={cellStyle}>
        <AccountDisplay transaction={transaction} compact={isWidget} />
      </TableCell>
      {!groupByDate && (
        <TableCell style={cellStyle}>
          {dateUtils.formatDate(transaction.date)}
        </TableCell>
      )}
      {!hideActions && (
        <TableCell align="right" style={cellStyle}>
          {editingTransaction?.identifier === transaction.identifier ? (
            <>
              <Tooltip title={t('common:actions.save')}>
                <IconButton onClick={handleSaveClick} sx={{ color: '#4ADE80' }}><CheckIcon /></IconButton>
              </Tooltip>
              <Tooltip title={t('common:actions.cancel')}>
                <IconButton onClick={handleCancelClick} sx={{ color: '#ef4444' }}><CloseIcon /></IconButton>
              </Tooltip>
            </>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Tooltip title={t('tx:tooltips.editTransaction')}>
                <IconButton onClick={(e) => { e.stopPropagation(); handleEditClick(transaction); }} size="small" sx={{ color: '#3b82f6' }}><EditIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={transaction.notes ? t('tx:tooltips.viewNotes') : t('tx:tooltips.openNotes')}>
                <IconButton onClick={(e) => { e.stopPropagation(); setEditingNotes({ identifier: transaction.identifier, vendor: transaction.vendor, content: transaction.notes || '' }); }} size="small" sx={{ color: transaction.notes ? theme.palette.primary.main : theme.palette.text.disabled }}><NotesIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('tx:tooltips.deleteTransaction')}>
                <IconButton onClick={(e) => { e.stopPropagation(); setConfirmDeleteTransaction(transaction); }} size="small" sx={{ color: '#ef4444' }}><DeleteIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Box>
          )}
          {editingNotes?.identifier === transaction.identifier && editingNotes?.vendor === transaction.vendor && (
            <Box onClick={(e) => e.stopPropagation()} sx={{ position: 'fixed', zIndex: 1000, bgcolor: 'background.paper', p: 2, borderRadius: 2, boxShadow: 3, border: 1, borderColor: 'divider', width: 250, right: 50 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('tx:notes.title')}</Typography>
              <TextField fullWidth multiline rows={3} placeholder={t('tx:notes.placeholder')} value={editingNotes.content} onChange={(e) => setEditingNotes({ ...editingNotes, content: e.target.value })} size="small" sx={{ mb: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button size="small" onClick={() => setEditingNotes(null)}>{t('common:actions.cancel')}</Button>
                <Button variant="contained" size="small" onClick={() => onNotesUpdate(transaction, editingNotes.content)}>{t('common:actions.save')}</Button>
              </Box>
            </Box>
          )}
        </TableCell>
      )}
    </TableRow>
  );
});
TransactionRow.displayName = 'TransactionRow';

interface TransactionMobileCardProps {
  transaction: Transaction;
  theme: any;
  onEdit: () => void;
  onDelete: () => void;
  getCardVendor: (accountNumber: string | undefined | null) => string | null;
  getCardNickname: (accountNumber: string | undefined | null) => string | null | undefined;
  showDate?: boolean;
  isEditing?: boolean;
  editCategory?: string;
  setEditCategory?: (val: string) => void;
  availableCategories?: string[];
  applyToAll?: boolean;
  setApplyToAll?: (val: boolean) => void;
  editPrice?: string;
  setEditPrice?: (val: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  onToggleFavorite?: () => void;
  onNotesUpdate?: (notes: string) => void;
  isBankView?: boolean;
}

const TransactionMobileCardContent = ({
  transaction,
  theme,
  onEdit,
  onDelete,
  onToggleFavorite,
  onNotesUpdate,
  getCardVendor,
  getCardNickname,
  showDate,
  isEditing,
  editCategory,
  setEditCategory,
  availableCategories,
  applyToAll,
  setApplyToAll,
  editPrice,
  setEditPrice,
  onSave,
  onCancel,
  isBankView = false
}: TransactionMobileCardProps) => {
  const { t } = useTranslation(['tx', 'common']);
  const [showNoteInput, setShowNoteInput] = React.useState(false);
  const [noteContent, setNoteContent] = React.useState(transaction.notes || '');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }}
            sx={{
              color: transaction.is_favorite ? '#fbbf24' : theme.palette.text.disabled,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              p: '4px',
              '&:hover': {
                transform: 'scale(1.1)',
                color: '#fbbf24',
              }
            }}
          >
            {transaction.is_favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
          <Box sx={{ ml: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>{transaction.name}</Typography>
            {showDate && <Typography variant="caption" display="block" color="text.secondary">{dateUtils.formatDate(transaction.date)}</Typography>}
            {transaction.notes && !showNoteInput && <Typography variant="caption" fontStyle="italic" color="text.secondary" display="block">{transaction.notes}</Typography>}
          </Box>
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: transaction.price < 0 ? '#ef4444' : '#10b981' }}>
          {isBankView && transaction.price >= 0 ? '+' : ''}₪{formatNumber(Math.abs(transaction.price))}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        {isEditing ? (
          <CategoryAutocomplete value={editCategory || ''} onChange={setEditCategory || (() => { })} options={availableCategories || []} applyToAll={applyToAll || false} onApplyToAllChange={setApplyToAll || (() => { })} showApplyToAll={editCategory !== transaction.category} />
        ) : <Typography variant="caption" sx={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.1)', p: '2px 8px', borderRadius: 1 }}>{transaction.category}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <CardVendorIcon vendor={getCardVendor(transaction.account_number)} size={16} />
          <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>{getCardNickname(transaction.account_number) || t('tx:table.fallbackCardLabel')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {isEditing ? (
            <>
              <Tooltip title={t('common:actions.save')}>
                <IconButton size="small" onClick={onSave} sx={{ color: '#10b981' }}><CheckIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('common:actions.cancel')}>
                <IconButton size="small" onClick={onCancel} sx={{ color: '#ef4444' }}><CloseIcon fontSize="small" /></IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip title={t('tx:tooltips.editTransaction')}>
                <IconButton size="small" onClick={onEdit} sx={{ color: '#3b82f6' }}><EditIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={transaction.notes ? t('tx:tooltips.viewNotes') : t('tx:tooltips.openNotes')}>
                <IconButton size="small" onClick={() => setShowNoteInput(!showNoteInput)} sx={{ color: transaction.notes ? theme.palette.primary.main : theme.palette.text.disabled }}><NotesIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('tx:tooltips.deleteTransaction')}>
                <IconButton size="small" onClick={onDelete} sx={{ color: '#ef4444' }}><DeleteIcon fontSize="small" /></IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      </Box>
      {showNoteInput && (
        <Box sx={{ mt: 1 }}>
          <TextField fullWidth multiline rows={2} size="small" placeholder={t('tx:notes.placeholder')} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
            <Button size="small" onClick={() => setShowNoteInput(false)}>{t('common:actions.cancel')}</Button>
            <Button size="small" variant="contained" onClick={() => { onNotesUpdate?.(noteContent); setShowNoteInput(false); }}>{t('common:actions.save')}</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const TransactionMobileCard = (props: any) => (
  <Paper elevation={0} sx={{ p: 2, borderRadius: '16px', border: 1, borderColor: 'divider' }}>
    <TransactionMobileCardContent {...props} />
  </Paper>
);

export default TransactionsTable;