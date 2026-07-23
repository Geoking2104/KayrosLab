import { useState } from 'react';
import { createCampaign } from '../data/campaignStore.js';
import { useI18n } from '../i18n/I18nContext.jsx';
import { useToast } from './Toast.jsx';

export default function CampaignForm({ onCreated, onCancel }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [prizes, setPrizes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      toast(t('app.campaigns.nameRequired'), { type: 'error' });
      return;
    }
    if (name.trim().length < 3) {
      toast(t('app.campaigns.nameTooShort'), { type: 'error' });
      return;
    }
    try {
      const campaign = createCampaign({
        name: name.trim(),
        description: description.trim(),
        endDate: endDate || null,
        prizes: prizes.trim(),
      });
      onCreated(campaign);
    } catch (e) {
      toast(`${t('app.toast.error')}: ${e.message || t('app.toast.error')}`, { type: 'error' });
    }
  };

  return (
    <form className="campaign-form" onSubmit={handleSubmit}>
      <h3>{t('app.campaigns.title')}</h3>
      <label>
        {t('app.campaigns.name')} *
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('app.campaigns.namePlaceholder')} required autoFocus />
      </label>
      <label>
        {t('app.campaigns.description')}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t('app.campaigns.descriptionPlaceholder')} />
      </label>
      <label>
        {t('app.campaigns.endDate')}
        <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label>
        {t('app.campaigns.prizes')}
        <input type="text" value={prizes} onChange={(e) => setPrizes(e.target.value)} placeholder={t('app.campaigns.prizesPlaceholder')} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">{t('app.campaigns.create_btn')}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{t('app.campaigns.cancel')}</button>
      </div>
    </form>
  );
}
