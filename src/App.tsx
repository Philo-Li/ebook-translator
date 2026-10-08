import { useEffect, useState } from 'react';
import EbookTranslator from './components/EbookTranslator';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  RTL_LOCALES,
  detectLocale,
  persistLocale,
  useTranslations,
  type Locale,
} from './i18n';

type Theme = 'dark' | 'light';
const THEME_STORAGE_KEY = 'ebook-translator:theme';

function detectTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const REPO_URL = 'https://github.com/Philo-Li/ebook-translator';

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale());
  const [theme, setTheme] = useState<Theme>(() => detectTheme());
  const t = useTranslations(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';
    document.title = t('meta.title');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (meta) meta.content = t('meta.description');
  }, [locale, t]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const onLocaleChange = (next: string) => {
    const safe = (LOCALES as readonly string[]).includes(next) ? (next as Locale) : DEFAULT_LOCALE;
    setLocale(safe);
    persistLocale(safe);
  };

  return (
    <>
      <nav className="app-bar">
        <a className="app-bar__brand" href="./">Ebook Translator</a>
        <div className="app-bar__controls">
          <select
            className="app-bar__select"
            aria-label="Interface language"
            value={locale}
            onChange={e => onLocaleChange(e.target.value)}
          >
            {LOCALES.map(code => (
              <option key={code} value={code}>{LOCALE_NAMES[code]}</option>
            ))}
          </select>
          <button
            type="button"
            className="app-bar__button"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </nav>

      <div className="bt" id="bt-root">
        <header className="bt__header">
          <div className="bt__eyebrow">{t('ebookTranslator.eyebrow')}</div>
          <h1 className="bt__title">{t('ebookTranslator.title')}</h1>
          <p className="bt__subtitle">{t('ebookTranslator.subtitle')}</p>
        </header>
        <EbookTranslator locale={locale} />
      </div>

      <footer className="app-footer">
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">Open source on GitHub</a>
        {' · '}
        <a href="https://philoli.com/projects/ebook-translator" target="_blank" rel="noopener noreferrer">philoli.com</a>
      </footer>
    </>
  );
}
