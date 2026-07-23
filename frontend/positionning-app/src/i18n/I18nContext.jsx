import { createContext, useContext, useState, useCallback } from 'react';
import { t as coreT, LOCALES } from './index.js';

const I18nContext = createContext({ locale: 'en', setLocale: () => {}, t: (k, f) => f });

export function I18nProvider({ children, defaultLocale = 'en' }) {
  const [locale, setLocale] = useState(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('kayros-locale') : null;
    return stored && LOCALES[stored] ? stored : defaultLocale;
  });

  const changeLocale = useCallback((l) => {
    setLocale(l);
    if (typeof localStorage !== 'undefined') localStorage.setItem('kayros-locale', l);
  }, []);

  const t = useCallback((key, fallback) => coreT(locale, key, fallback), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale: changeLocale, t, available: LOCALES }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
