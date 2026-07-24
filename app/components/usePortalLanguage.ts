'use client';

import { useEffect, useState } from 'react';
import { defaultLanguage, languageStorageKey, type Language } from '../../lib/i18n/translations';

export function usePortalLanguage() {
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === 'en' || stored === 'zh') setLanguage(stored);

    function onLanguageChange(event: Event) {
      const next = (event as CustomEvent<Language>).detail;
      if (next === 'en' || next === 'zh') setLanguage(next);
    }

    function onStorage(event: StorageEvent) {
      if (event.key === languageStorageKey && (event.newValue === 'en' || event.newValue === 'zh')) {
        setLanguage(event.newValue);
      }
    }

    window.addEventListener('nexora-language-change', onLanguageChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('nexora-language-change', onLanguageChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return language;
}
