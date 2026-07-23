import { useState, useEffect, useRef } from 'react';
import { getCampaign, listSubmissions, addSubmission, removeSubmission, updateCampaign } from '../data/campaignStore.js';
import { useI18n } from '../i18n/I18nContext.jsx';

function Countdown({ endDate }) {
  const { t } = useI18n();
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endDate) - Date.now();
      if (diff <= 0) return setRemaining(t('app.campaigns.expired'));
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setRemaining(`${d}d ${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [endDate, t]);

  return <span className="countdown">{remaining}</span>;
}

export default function CampaignDetail({ campaignId, onBack, onAnalyze }) {
  const { t } = useI18n();
  const [campaign, setCampaign] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [author, setAuthor] = useState('');
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (unmountedRef.current) return;
    setCampaign(getCampaign(campaignId));
    setSubmissions(listSubmissions(campaignId));
  }, [campaignId]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!unmountedRef.current) {
        setNow(Date.now());
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);
  const { t } = useI18n();
  const [campaign, setCampaign] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [author, setAuthor] = useState('');
  const [idea, setIdea] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setCampaign(getCampaign(campaignId));
    setSubmissions(listSubmissions(campaignId));
  }, [campaignId]);

  const refresh = () => {
    if (unmountedRef.current) return;
    setCampaign(getCampaign(campaignId));
    setSubmissions(listSubmissions(campaignId));
    setSubmitting(false);
  };

  const handleSubmitIdea = async (e) => {
    e.preventDefault();
    if (!idea.trim() || !author.trim()) return;
    setSubmitting(true);
    try {
      const result = await onAnalyze(idea.trim());
      addSubmission({
        campaignId,
        idea: idea.trim(),
        author: author.trim(),
        ki: result?.kayrosIndex ?? null,
        scores: result?.baseline ?? null,
        competitors: result?.competitors ?? [],
      });
      setIdea('');
      refresh();
    } catch {
      refresh();
    }
  };

  const handleClose = () => {
    if (campaign) updateCampaign(campaignId, { status: 'closed' });
    refresh();
  };

  const handleReopen = () => {
    updateCampaign(campaignId, { status: 'open' });
    refresh();
  };

  if (!campaign) return <p>{t('app.campaigns.notFound')}</p>;

  const isOpen = campaign.status === 'open' && (!campaign.endDate || new Date(campaign.endDate) > now);

  return (
    <div className="campaign-detail">
      <button className="btn btn-outline btn-sm mb-8" onClick={onBack}>← {t('app.campaigns.back')}</button>

      <div className="campaign-detail-header">
        <div>
          <h3>{campaign.name}</h3>
          {campaign.description && <p className="campaign-detail-desc">{campaign.description}</p>}
        </div>
        <div className="campaign-detail-actions">
          {isOpen ? (
            <button className="btn btn-outline btn-sm" onClick={handleClose}>{t('app.campaigns.close')}</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={handleReopen}>{t('app.campaigns.reopen')}</button>
          )}
        </div>
      </div>

      <div className="campaign-meta-row">
        {campaign.endDate && <Countdown endDate={campaign.endDate} />}
        {campaign.prizes && <span className="campaign-prizes">🎁 {campaign.prizes}</span>}
        <span className="campaign-status-dot" data-open={isOpen}>{isOpen ? t('app.campaigns.open') : t('app.campaigns.closed')}</span>
      </div>

      {isOpen && (
        <form className="campaign-submit-form" onSubmit={handleSubmitIdea}>
          <h4>{t('app.campaigns.submitIdea')}</h4>
          <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder={t('app.campaigns.teamName')} required disabled={submitting} />
          <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={2} placeholder={t('app.campaigns.ideaPlaceholder')} required disabled={submitting} />
          <button type="submit" className="btn btn-primary" disabled={submitting || !author.trim() || !idea.trim()}>
            {submitting ? t('app.campaigns.analyzing') : t('app.campaigns.submitAnalyze')}
          </button>
        </form>
      )}

      <div className="leaderboard">
        <h4>{t('app.campaigns.leaderboard')} ({submissions.length})</h4>
        {submissions.length === 0 ? (
          <p className="leaderboard-empty">{t('app.campaigns.noSubmissions')}</p>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>{t('app.campaigns.colNumber')}</th>
                <th>{t('app.campaigns.colTeam')}</th>
                <th>{t('app.campaigns.colIdea')}</th>
                <th>{t('app.campaigns.colKi')}</th>
                <th>{t('app.campaigns.colDate')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s, i) => (
                <tr key={s.id} className={i === 0 ? 'rank-first' : ''}>
                  <td className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</td>
                  <td className="team-name">{s.author}</td>
                  <td className="team-idea">{s.idea}</td>
                  <td className="team-ki">{s.ki !== null ? `${s.ki}/100` : '—'}</td>
                  <td className="team-date">{new Date(s.submittedAt).toLocaleDateString()}</td>
                  <td>
                    <button className="btn-outline btn-xs" onClick={() => { removeSubmission(s.id); refresh(); }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
