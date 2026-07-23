const STORE_KEY = 'kayros_settings';

const DEFAULTS = {
  theme: 'light',
  locale: 'fr',
  gapThreshold: 5,
  apiKey: '',
  slackWebhookUrl: '',
  slackAutoSend: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  applyTheme(settings.theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
