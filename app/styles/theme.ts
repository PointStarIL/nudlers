
import { createTheme, ThemeOptions } from '@mui/material/styles';

type Mode = 'light' | 'dark';
type Direction = 'ltr' | 'rtl';

// Common settings
const baseTheme: ThemeOptions = {
    typography: {
        fontFamily: "'Outfit', 'Assistant', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
        h1: { fontWeight: 800, letterSpacing: '-0.02em' },
        h2: { fontWeight: 700, letterSpacing: '-0.02em' },
        h3: { fontWeight: 700, letterSpacing: '-0.01em' },
        h4: { fontWeight: 600 },
        h5: { fontWeight: 600 },
        h6: { fontWeight: 600 },
        button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 10,
                    boxShadow: 'none',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: 'var(--n-shadow-md)',
                    },
                    '&:active': {
                        transform: 'translateY(0)',
                    },
                },
                containedPrimary: {
                    background: 'var(--n-primary)',
                    '&:hover': {
                        background: 'var(--n-primary-hover)',
                    },
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    borderRadius: 16,
                    border: '1px solid var(--n-border)',
                    backgroundColor: 'var(--n-bg-surface)',
                    boxShadow: 'var(--n-shadow-md)',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                        boxShadow: 'var(--n-shadow-lg)',
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    backgroundColor: 'var(--n-bg-surface)',
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: '1px solid var(--n-border)',
                },
                head: {
                    fontWeight: 700,
                    backgroundColor: 'var(--n-bg-surface-alt)',
                    color: 'var(--n-text-secondary)',
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    borderRadius: 20,
                    boxShadow: 'var(--n-shadow-xl)',
                    border: '1px solid var(--n-border)',
                },
            },
        },
    },
};

const lightPalette: ThemeOptions['palette'] = {
    mode: 'light',
    primary: {
        main: '#6366f1',
        light: '#818cf8',
        dark: '#4f46e5',
    },
    secondary: {
        main: '#71717a',
        light: '#a1a1aa',
        dark: '#52525b',
    },
    background: {
        default: '#fafafa',
        paper: '#ffffff',
    },
    text: {
        primary: '#09090b',
        secondary: '#52525b',
    },
    divider: '#e4e4e7',
};

const darkPalette: ThemeOptions['palette'] = {
    mode: 'dark',
    primary: {
        main: '#6366f1',
        light: '#818cf8',
        dark: '#4f46e5',
    },
    secondary: {
        main: '#a1a1aa',
        light: '#d4d4d8',
        dark: '#71717a',
    },
    background: {
        default: '#09090b',
        paper: '#18181b',
    },
    text: {
        primary: '#fafafa',
        secondary: '#a1a1aa',
    },
    divider: '#27272a',
};

export const buildTheme = (mode: Mode, direction: Direction = 'ltr') =>
    createTheme({
        ...baseTheme,
        direction,
        palette: mode === 'light' ? lightPalette : darkPalette,
    });

export const lightTheme = buildTheme('light');
export const darkTheme = buildTheme('dark');
