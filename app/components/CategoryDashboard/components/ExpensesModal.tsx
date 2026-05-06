import React from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../../utils/client-logger';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import ModalHeader from '../../ModalHeader';

import Table, { Column } from '../../Table';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import CheckIcon from '@mui/icons-material/Check';
import EditIcon from '@mui/icons-material/Edit';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ExpensesModalProps, Expense } from '../types';
import { formatNumber } from '../utils/format';
import { dateUtils } from '../utils/dateUtils';
import Box from '@mui/material/Box';
import DeleteIcon from '@mui/icons-material/Delete';
import SortIcon from '@mui/icons-material/Sort';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useCategories } from '../utils/useCategories';
import { useCardVendors } from '../utils/useCardVendors';
import { CardVendorIcon } from '../../CardVendorsModal';
import TransactionsTable from './TransactionsTable';

type SortField = 'date' | 'processed_date' | 'price' | 'installments_number' | 'name' | 'category' | 'card';
type SortDirection = 'asc' | 'desc';



const ExpensesModal: React.FC<ExpensesModalProps> = ({ open, onClose, data, color, setModalData, currentMonth }) => {
  const theme = useTheme();
  const { t } = useTranslation('tx');
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [snackbar, setSnackbar] = React.useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success'
  });
  const [sortField, setSortField] = React.useState<SortField>('date');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc');

  const isBankView = data.type === "Bank Transactions" ||
    data.type === "All Bank Expenses" ||
    (data.type && (data.type.startsWith('Account') || data.type.startsWith('Bank') || data.type.startsWith('Search:')));

  // Sort function for expenses
  const getSortedData = React.useCallback((expenses: Expense[]) => {
    if (!Array.isArray(expenses)) return expenses;

    return [...expenses].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'processed_date':
          comparison = new Date(a.processed_date || 0).getTime() - new Date(b.processed_date || 0).getTime();
          break;
        case 'price':
          // Sort by actual value (including sign) - negative amounts come before positive in ascending order
          comparison = a.price - b.price;
          break;
        case 'installments_number':
          const installA = a.installments_total || 0;
          const installB = b.installments_total || 0;
          comparison = installA - installB;
          break;
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '');
          break;
        case 'category':
          comparison = (a.category || '').localeCompare(b.category || '');
          break;
        case 'card':
          const cardA = a.vendor_nickname || a.vendor || '';
          const cardB = b.vendor_nickname || b.vendor || '';
          comparison = cardA.localeCompare(cardB);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [sortField, sortDirection]);

  const handleSortChange = (field: string) => {
    const sField = field as SortField;
    if (sField === sortField) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(sField);
      setSortDirection('desc');
    }
  };

  const handleUpdateTransaction = async (expense: Expense, updates: Partial<Expense>) => {
    try {
      const response = await fetch(`/api/transactions/${expense.identifier}|${expense.vendor}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (response.ok) {
        // Update the local data
        const updatedData = data.data.map((item: Expense) =>
          item.identifier === expense.identifier && item.vendor === expense.vendor
            ? { ...item, ...updates }
            : item
        );

        setModalData?.({
          ...data,
          data: updatedData
        });

        // Trigger a refresh of the dashboard data
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        setSnackbar({
          open: true,
          message: t('snackbar.updateTransactionFailed'),
          severity: 'error'
        });
      }
    } catch (error) {
      logger.error('Error updating transaction', error as Error);
      setSnackbar({
        open: true,
        message: t('snackbar.updateTransactionError'),
        severity: 'error'
      });
    }
  };

  const sortedExpenses = React.useMemo(() => getSortedData(data.data), [data.data, getSortedData]);



  const handleDeleteTransaction = async (expense: Expense) => {
    try {
      // Use identifier-based delete if available, otherwise fall back to name-based delete
      if (expense.identifier && expense.vendor) {
        const response = await fetch(`/api/transactions/${expense.identifier}|${expense.vendor}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          // Remove the transaction from the local data
          const updatedData = data.data.filter((item: Expense) =>
            !(item.identifier === expense.identifier && item.vendor === expense.vendor)
          );

          // Update the modal data if setModalData is provided
          setModalData?.({
            ...data,
            data: updatedData
          });

          setSnackbar({
            open: true,
            message: t('snackbar.deleteSuccess'),
            severity: 'success'
          });

          // Trigger a refresh of the dashboard data
          window.dispatchEvent(new CustomEvent('dataRefresh'));
        } else {
          setSnackbar({
            open: true,
            message: t('snackbar.deleteTransactionFailed'),
            severity: 'error'
          });
        }
      } else {
        logger.error('Cannot delete transaction: missing identifier or vendor', expense);
        setSnackbar({
          open: true,
          message: t('snackbar.missingIdentifier'),
          severity: 'error'
        });
      }
    } catch (error) {
      logger.error('Error deleting transaction', error as Error);
      setSnackbar({
        open: true,
        message: t('snackbar.deleteError'),
        severity: 'error'
      });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={isMobile}
      PaperProps={{
        sx: {
          background: theme.palette.mode === 'dark'
            ? 'rgba(15, 23, 42, 0.95)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.98) 100%)',
          backdropFilter: 'blur(20px)',
          borderRadius: isMobile ? 0 : '28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.15)',
          border: isMobile ? 'none' : `1px solid ${theme.palette.divider}`,
          margin: isMobile ? 0 : undefined,
        }
      }}
      BackdropProps={{
        style: {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)'
        }
      }}
    >
      <ModalHeader title={data.type} onClose={onClose} />
      <DialogContent sx={{ padding: { xs: '12px', sm: '16px', md: '32px' } }}>



        <Box sx={{
          borderRadius: '20px',
          overflow: 'hidden',
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.08)',
          background: theme.palette.mode === 'dark' ? 'rgba(30, 41, 59, 0.4)' : 'rgba(255, 255, 255, 0.6)',
          backdropFilter: 'blur(20px)'
        }}>
          <TransactionsTable
            transactions={sortedExpenses}
            onUpdate={handleUpdateTransaction}
            onDelete={handleDeleteTransaction}
            sortBy={sortField}
            sortOrder={sortDirection}
            onSort={handleSortChange}
            showProcessedDate={true}
            isBankView={!!isBankView}
            disableWrapper={true}
          />
        </Box>
      </DialogContent >

      {/* Snackbar for feedback messages */}
      < Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{
            width: '100%',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar >
    </Dialog >
  );
};

export default ExpensesModal; 