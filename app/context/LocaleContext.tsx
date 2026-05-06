import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { I18nextProvider } from 'react-i18next';
import i18n, { type Locale, directionForLocale, SUPPORTED_LOCALES } from '../i18n/config';

interface LocaleContextValue {
    locale: Locale;
    direction: 'ltr' | 'rtl';
    setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
    locale: 'en',
    direction: 'ltr',
    setLocale: () => { },
});

export const useLocale = () => useContext(LocaleContext);

const cacheLtr = createCache({ key: 'nudlers', prepend: true });
const cacheRtl = createCache({
    key: 'nudlers-rtl',
    stylisPlugins: [prefixer, rtlPlugin],
    prepend: true,
});

const isLocale = (value: unknown): value is Locale =>
    typeof value === 'string' && (SUPPORTED_LOCALES as string[]).includes(value);

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [locale, setLocaleState] = useState<Locale>(() => {
        if (typeof window === 'undefined') return 'en';
        const saved = window.localStorage.getItem('locale');
        return isLocale(saved) ? saved : 'en';
    });

    const direction = directionForLocale(locale);

    const setLocale = (next: Locale) => {
        setLocaleState(next);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem('locale', next);
        }
    };

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.dir = direction;
        document.documentElement.lang = locale;
        if (i18n.language !== locale) {
            i18n.changeLanguage(locale);
        }
    }, [locale, direction]);

    const value = useMemo(() => ({ locale, direction, setLocale }), [locale, direction]);
    const cache = direction === 'rtl' ? cacheRtl : cacheLtr;

    return (
        <I18nextProvider i18n={i18n}>
            <LocaleContext.Provider value={value}>
                <CacheProvider value={cache}>{children}</CacheProvider>
            </LocaleContext.Provider>
        </I18nextProvider>
    );
};
