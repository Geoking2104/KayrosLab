import { useState } from 'react';
import { sendToSlack } from '../utils/slack.js';
import { loadSettings, saveSettings } from '../data/settingsStore.js';

export default function SettingsPage({ onSettingsChange, analysisData }) {
  const [settings, setSettings] = useState(loadSettings);
  const [slackStatus, setSlackStatus] = useState('');

  const update = (field, value) => {
    const next = { ...settings, [field]: value };
    setSettings(next);
    saveSettings(next);
    if (onSettingsChange) onSettingsChange(next);
  };

  const handleTestSlack = async () => {
    if (!settings.slackWebhookUrl) return;
    setSlackStatus('sending');
    try {
      await sendToSlack(settings.slackWebhookUrl, {
        idea: analysisData?.idea || 'Test from KayrosLab Settings',
        ki: analysisData?.ki ?? 42,
        competitors: analysisData?.competitors || [{ name: 'Example Corp', avgScore: 65 }],
        gaps: analysisData?.gaps || [{ icon: '📊', neuronId: 'Example', diff: 12, type: 'advantage' }],
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
      <h3>Settings</h3>

      <div className="settings-group">
        <label className="settings-label">Theme</label>
        <div className="settings-toggle">
          <button
            className={`toggle-btn ${settings.theme === 'light' ? 'active' : ''}`}
            onClick={() => update('theme', 'light')}
          >☀️ Light</button>
          <button
            className={`toggle-btn ${settings.theme === 'dark' ? 'active' : ''}`}
            onClick={() => update('theme', 'dark')}
          >🌙 Dark</button>
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">Language</label>
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
        <label className="settings-label" htmlFor="gapThreshold">Gap Threshold</label>
        <p className="settings-hint">Minimum score difference to show as advantage/disadvantage</p>
        <input
          id="gapThreshold"
          type="range"
          min="1"
          max="20"
          value={settings.gapThreshold}
          onChange={(e) => update('gapThreshold', Number(e.target.value))}
        />
        <span className="settings-value">{settings.gapThreshold} pts</span>
      </div>

      <div className="settings-group">
        <label className="settings-label" htmlFor="apiKey">Backend API Key</label>
        <p className="settings-hint">Optional key sent as X-API-Key header to the backend BFF</p>
        <input
          id="apiKey"
          type="password"
          value={settings.apiKey}
          onChange={(e) => update('apiKey', e.target.value)}
          placeholder="sk-..."
        />
      </div>

      <hr className="settings-divider" />

      <h4 className="settings-subtitle">Slack Integration</h4>

      <div className="settings-group">
        <label className="settings-label" htmlFor="slackWebhookUrl">Webhook URL</label>
        <p className="settings-hint">Incoming webhook URL from Slack Apps → Incoming Webhooks</p>
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
          {' '}Auto-send after each analysis
        </label>
      </div>

      <div className="settings-group">
        <button className="btn btn-outline btn-sm" onClick={handleTestSlack} disabled={!settings.slackWebhookUrl || slackStatus === 'sending'}>
          {slackStatus === 'sending' ? 'Sending...' : slackStatus === 'sent' ? '✓ Sent!' : slackStatus === 'error' ? '✕ Failed' : 'Test Webhook'}
        </button>
      </div>
    </div>
  );
}
