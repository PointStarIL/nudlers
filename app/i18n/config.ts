import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enNav from './locales/en/nav.json';
import enPageHeader from './locales/en/pageHeader.json';
import enVault from './locales/en/vault.json';
import enViews from './locales/en/views.json';
import enTx from './locales/en/tx.json';
import enCategoryMgmt from './locales/en/categoryMgmt.json';
import enSync from './locales/en/sync.json';
import enScrape from './locales/en/scrape.json';
import enMisc from './locales/en/misc.json';
import heCommon from './locales/he/common.json';
import heSettings from './locales/he/settings.json';
import heNav from './locales/he/nav.json';
import hePageHeader from './locales/he/pageHeader.json';
import heVault from './locales/he/vault.json';
import heViews from './locales/he/views.json';
import heTx from './locales/he/tx.json';
import heCategoryMgmt from './locales/he/categoryMgmt.json';
import heSync from './locales/he/sync.json';
import heScrape from './locales/he/scrape.json';
import heMisc from './locales/he/misc.json';

export type Locale = 'en' | 'he';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'he'];

const resources = {
    en: {
        common: enCommon,
        settings: enSettings,
        nav: enNav,
        pageHeader: enPageHeader,
        vault: enVault,
        views: enViews,
        tx: enTx,
        categoryMgmt: enCategoryMgmt,
        sync: enSync,
        scrape: enScrape,
        misc: enMisc,
    },
    he: {
        common: heCommon,
        settings: heSettings,
        nav: heNav,
        pageHeader: hePageHeader,
        vault: heVault,
        views: heViews,
        tx: heTx,
        categoryMgmt: heCategoryMgmt,
        sync: heSync,
        scrape: heScrape,
        misc: heMisc,
    },
} as const;

if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
        resources,
        lng: 'en',
        fallbackLng: 'en',
        ns: ['common', 'settings', 'nav', 'pageHeader', 'vault', 'views', 'tx', 'categoryMgmt', 'sync', 'scrape', 'misc'],
        defaultNS: 'common',
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    });
}

export const directionForLocale = (locale: Locale): 'ltr' | 'rtl' =>
    locale === 'he' ? 'rtl' : 'ltr';

export default i18n;
