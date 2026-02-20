import { useEffect } from 'react';
import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { AppThemeProvider } from '../context/ThemeContext';
import { StatusProvider } from '../context/StatusContext';

function MyApp({ Component, pageProps }: AppProps) {
  // Handle chunk load errors globally (e.g. after a new deployment)
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = event.message || '';
      if (msg.includes('Loading chunk') || msg.includes('Failed to load chunk') || msg.includes('Loading CSS chunk')) {
        event.preventDefault();
        const reloadKey = 'chunk-error-reload';
        const lastReload = sessionStorage.getItem(reloadKey);
        if (!lastReload || Date.now() - Number(lastReload) > 30000) {
          sessionStorage.setItem(reloadKey, String(Date.now()));
          window.location.reload();
        }
      }
    };

    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  return (
    <AppThemeProvider>
      <StatusProvider>
        <Component {...pageProps} />
      </StatusProvider>
    </AppThemeProvider>
  );
}

export default MyApp;
