import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../utils/client-logger';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  LinearProgress,
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip
} from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import StorageIcon from '@mui/icons-material/Storage';
import TableChartIcon from '@mui/icons-material/TableChart';

interface DatabaseBackupModalProps {
  open: boolean;
  onClose: () => void;
}

interface ImportResult {
  success: boolean;
  imported: Record<string, { count: number; skipped?: boolean }>;
  errors: Array<{ table: string; error: string }>;
}

const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    background: theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, var(--modal-backdrop) 0%, var(--modal-backdrop-alt) 100%)'
      : 'linear-gradient(135deg, var(--modal-backdrop) 0%, var(--modal-backdrop-alt) 100%)',
    backdropFilter: 'blur(20px)',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: '16px',
    color: theme.palette.text.primary,
    minWidth: '500px'
  }
}));

const ActionCard = styled(Box)(({ theme }) => ({
  padding: '24px',
  borderRadius: '12px',
  border: '1px solid var(--action-card-border)',
  background: 'var(--action-card-bg)',
  transition: 'all 0.3s ease',
  '&:hover': {
    borderColor: 'var(--action-card-hover-border)',
    background: 'var(--action-card-hover-bg)',
  }
}));

const HiddenInput = styled('input')({
  display: 'none'
});

const DatabaseBackupModal: React.FC<DatabaseBackupModalProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation(['misc', 'common']);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [result, setResult] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    setResult(null);

    try {
      const response = await fetch('/api/maintenance/database/export');

      if (!response.ok) {
        throw new Error(t('misc:databaseBackup.export.errorGeneric'));
      }

      const data = await response.json();

      // Create and download the file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Count total rows
      const totalRows = Object.values(data.tables).reduce(
        (sum: number, table: any) => sum + (table.rowCount || 0),
        0
      );

      setResult({
        type: 'success',
        message: t('misc:databaseBackup.export.successMessage', { rows: totalRows, tables: Object.keys(data.tables).length })
      });
    } catch (error) {
      logger.error('Export error', error as Error);
      setResult({
        type: 'error',
        message: t('misc:databaseBackup.export.errorMessage')
      });
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      setImportResult(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setImporting(true);
    setResult(null);
    setImportResult(null);

    try {
      const fileContent = await selectedFile.text();
      const data = JSON.parse(fileContent);

      // Validate backup format
      if (!data.tables || !data.version) {
        throw new Error(t('misc:databaseBackup.import.invalidFormatError'));
      }

      const response = await fetch('/api/maintenance/database/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data, mode: importMode })
      });

      const importRes: ImportResult = await response.json();

      if (!response.ok) {
        throw new Error((importRes as any).error || t('misc:databaseBackup.import.errorGeneric'));
      }

      setImportResult(importRes);

      if (importRes.success) {
        const totalImported = Object.values(importRes.imported).reduce(
          (sum, t) => sum + (t.count || 0),
          0
        );
        setResult({
          type: 'success',
          message: t('misc:databaseBackup.import.successMessage', { count: totalImported })
        });
        // Trigger data refresh
        window.dispatchEvent(new CustomEvent('dataRefresh'));
      } else {
        setResult({
          type: 'warning',
          message: t('misc:databaseBackup.import.warningMessage')
        });
      }
    } catch (error: any) {
      logger.error('Import error', error);
      setResult({
        type: 'error',
        message: error.message || t('misc:databaseBackup.import.errorMessage')
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setImportResult(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  return (
    <StyledDialog open={open} onClose={handleClose} maxWidth="md">
      <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        borderBottom: `1px solid ${theme.palette.divider}`,
        pb: 2
      }}>
        <StorageIcon sx={{ color: 'var(--status-info)' }} />
        <Typography variant="h6" sx={{ fontWeight: 600, color: theme.palette.text.primary }}>
          {t('misc:databaseBackup.title')}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        {result && (
          <Alert
            severity={result.type === 'warning' ? 'warning' : result.type}
            sx={{ mb: 3 }}
            icon={
              result.type === 'success' ? <CheckCircleIcon /> :
                result.type === 'warning' ? <WarningIcon /> : <ErrorIcon />
            }
          >
            {result.message}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Export Section */}
          <ActionCard>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
              <CloudDownloadIcon sx={{ color: 'var(--status-success)', fontSize: 32 }} />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5, color: theme.palette.text.primary }}>
                  {t('misc:databaseBackup.export.heading')}
                </Typography>
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  {t('misc:databaseBackup.export.description')}
                </Typography>
              </Box>
            </Box>
            <Button
              variant="contained"
              startIcon={<CloudDownloadIcon />}
              onClick={handleExport}
              disabled={exporting || importing}
              sx={{
                background: 'linear-gradient(135deg, var(--status-success) 0%, #16a34a 100%)',
                color: '#fff',
                '&:hover': {
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                }
              }}
            >
              {exporting ? t('misc:databaseBackup.export.buttonExporting') : t('misc:databaseBackup.export.button')}
            </Button>
            {exporting && <LinearProgress sx={{ mt: 2 }} />}
          </ActionCard>

          <Divider sx={{ borderColor: theme.palette.divider }} />

          {/* Import Section */}
          <ActionCard>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
              <CloudUploadIcon sx={{ color: 'var(--status-info)', fontSize: 32 }} />
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5, color: theme.palette.text.primary }}>
                  {t('misc:databaseBackup.import.heading')}
                </Typography>
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  {t('misc:databaseBackup.import.description')}
                </Typography>
              </Box>
            </Box>

            <FormControl component="fieldset" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.primary, mb: 1 }}>
                {t('misc:databaseBackup.import.modeLabel')}
              </Typography>
              <RadioGroup
                row
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'replace' | 'merge')}
              >
                <FormControlLabel
                  value="replace"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>{t('misc:databaseBackup.import.replaceLabel')}</Typography>
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                        {t('misc:databaseBackup.import.replaceDescription')}
                      </Typography>
                    </Box>
                  }
                  sx={{ mr: 4 }}
                />
                <FormControlLabel
                  value="merge"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>{t('misc:databaseBackup.import.mergeLabel')}</Typography>
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                        {t('misc:databaseBackup.import.mergeDescription')}
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </FormControl>

            {importMode === 'replace' && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('misc:databaseBackup.import.replaceWarning')}
              </Alert>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <HiddenInput
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
              />
              <Button
                variant="outlined"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                sx={{
                  borderColor: 'var(--status-info)',
                  color: 'var(--status-info)',
                  '&:hover': {
                    borderColor: 'var(--status-info)',
                    backgroundColor: 'var(--chip-background)'
                  }
                }}
              >
                {t('misc:databaseBackup.import.selectFile')}
              </Button>
              {selectedFile && (
                <Chip
                  label={selectedFile.name}
                  onDelete={() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  sx={{
                    backgroundColor: 'var(--chip-background)',
                    color: 'var(--status-info)',
                    border: `1px solid var(--chip-border)`
                  }}
                />
              )}
            </Box>

            <Button
              variant="contained"
              startIcon={<CloudUploadIcon />}
              onClick={handleImport}
              disabled={!selectedFile || importing || exporting}
              sx={{
                mt: 2,
                background: 'linear-gradient(135deg, var(--status-info) 0%, #3b82f6 100%)',
                color: '#fff',
                '&:hover': {
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                }
              }}
            >
              {importing ? t('misc:databaseBackup.import.buttonImporting') : t('misc:databaseBackup.import.button')}
            </Button>
            {importing && <LinearProgress sx={{ mt: 2 }} />}
          </ActionCard>

          {/* Import Results */}
          {importResult && (
            <Box sx={{
              p: 2,
              borderRadius: '12px',
              backgroundColor: 'var(--action-card-bg)',
              border: `1px solid var(--action-card-border)`
            }}>
              <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1, color: theme.palette.text.primary }}>
                <TableChartIcon fontSize="small" />
                {t('misc:databaseBackup.results.heading')}
              </Typography>
              <List dense>
                {Object.entries(importResult.imported).map(([table, info]) => (
                  <ListItem key={table} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {info.skipped ? (
                        <WarningIcon sx={{ color: theme.palette.text.disabled, fontSize: 18 }} />
                      ) : (
                        <CheckCircleIcon sx={{ color: 'var(--status-success)', fontSize: 18 }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                          {table}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                          {info.skipped ? t('misc:databaseBackup.results.noData') : t('misc:databaseBackup.results.recordsCount', { count: info.count })}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
              {importResult.errors.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ color: 'var(--status-error)', mb: 1 }}>
                    {t('misc:databaseBackup.results.errorsHeading')}
                  </Typography>
                  {importResult.errors.map((err, idx) => (
                    <Typography key={idx} variant="caption" sx={{ color: 'var(--error-text)', display: 'block' }}>
                      {err.table}: {err.error}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{
        borderTop: `1px solid ${theme.palette.divider}`,
        p: 2
      }}>
        <Button
          onClick={handleClose}
          sx={{ color: theme.palette.text.secondary }}
        >
          {t('common:actions.close')}
        </Button>
      </DialogActions>
    </StyledDialog>
  );
};

export default DatabaseBackupModal;
