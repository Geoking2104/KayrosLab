import { useState } from 'react';
import { sendToSlack } from '../utils/slack.js';
import { loadSettings, saveSettings } from '../data/settingsStore.js';
import { useI18n } from '../i18n/I18nContext.jsx';

export default function SettingsPage({ onSettingsChange, analysisData }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState(() => loadSettings());
  const [slackStatus, setSlackStatus] = useState('');

  const update = (field, value) => {
    const next = { ...settings, [field]: value };
    try {
      setSettings(next);
      saveSettings(next);
      if (onSettingsChange) onSettingsChange(next);
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const handleTestSlack = async () => {
    if (!settings.slackWebhookUrl) return;
    setSlackStatus('sending');
    try {
      await sendToSlack(settings.slackWebhookUrl, {
        idea: analysisData?.idea || '',
        ki: analysisData?.ki ?? null,
        competitors: analysisData?.competitors || [],
        gaps: analysisData?.gaps || [],
      });
      setSlackStatus('sent');
      setTimeout(() => setSlackStatus(''), 3000);
    } catch {
      setSlackStatus('error');
      setTimeout(() => setSlackStatus(''), 3000);
    }
  };

  return (
    <div className="settings-page">
      <h3>{t('app.settings.title')}</h3>

      <div className="settings-group">
        <label className="settings-label">{t('app.settings.theme')}</label>
        <div className="settings-toggle">
          <button
            className={`toggle-btn ${settings.theme === 'light' ? 'active' : ''}`}
            onClick={() => update('theme', 'light')}
          >{t('app.settings.light')}</button>
          <button
            className={`toggle-btn ${settings.theme === 'dark' ? 'active' : ''}`}
            onClick={() => update('theme', 'dark')}
          >{t('app.settings.dark')}</button>
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">{t('app.settings.language')}</label>
        <div className="settings-toggle">
          <button
            className={`toggle-btn ${settings.locale === 'fr' ? 'active' : ''}`}
            onClick={() => update('locale', 'fr')}
          >🇫🇷 FR</button>
          <button
            className={`toggle-btn ${settings.locale === 'en' ? 'active' : ''}`}
            onClick={() => update('locale', 'en')}
          >🇬🇧 EN</button>
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label" htmlFor="gapThreshold">{t('app.settings.gapThreshold')}</label>
        <p className="settings-hint">{t('app.settings.gapThresholdDesc')}</p>
        <input
          id="gapThreshold"
          type="range"
          min="1"
          max="20"
          value={settings.gapThreshold}
          onChange={(e) => update('gapThreshold', Number(e.target.value))}
        />
        <span className="settings-value">{settings.gapThreshold} {t('app.settings.pts')}</span>
      </div>

      <div className="settings-group">
        <label className="settings-label" htmlFor="apiKey">{t('app.settings.apiKey')}</label>
        <p className="settings-hint">{t('app.settings.apiKeyDesc')}</p>
        <input
          id="apiKey"
          type="password"
          value={settings.apiKey}
          onChange={(e) => update('apiKey', e.target.value)}
          placeholder="sk-..."
        />
      </div>

      <hr className="settings-divider" />

      <h4 className="settings-subtitle">{t('app.settings.slackIntegration')}</h4>

      <div className="settings-group">
        <label className="settings-label" htmlFor="slackWebhookUrl">{t('app.settings.slackWebhookUrl')}</label>
        <p className="settings-hint">{t('app.settings.slackWebhookDesc')}</p>
        <input
          id="slackWebhookUrl"
          type="password"
          value={settings.slackWebhookUrl}
          onChange={(e) => update('slackWebhookUrl', e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
        />
      </div>

      <div className="settings-group">
        <label className="settings-label">
          <input type="checkbox" checked={settings.slackAutoSend} onChange={(e) => update('slackAutoSend', e.target.checked)} />
          {' '}{t('app.settings.slackAutoSend')}
        </label>
      </div>

      <div className="settings-group">
        <button className="btn btn-outline btn-sm" onClick={handleTestSlack} disabled={!settings.slackWebhookUrl || slackStatus === 'sending'}>
          {slackStatus === 'sending' ? t('app.settings.sending') : slackStatus === 'sent' ? t('app.settings.sent') : slackStatus === 'error' ? t('app.settings.failed') : t('app.settings.testWebhook')}
        </button>
      </div>
    </div>
  );
}
