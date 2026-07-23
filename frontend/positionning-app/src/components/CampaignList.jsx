import { useState, useEffect } from 'react';
import { listCampaigns } from '../data/campaignStore.js';
import CampaignForm from './CampaignForm.jsx';

export default function CampaignList({ onSelect }) {
  const [campaigns, setCampaigns] = useState([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { setCampaigns(listCampaigns()); }, []);

  const refresh = () => { setCampaigns(listCampaigns()); setShowForm(false); };

  const getStatusLabel = (c) => {
    if (c.status === 'closed') return { label: 'Closed', cls: 'badge-closed' };
    if (c.endDate && new Date(c.endDate) < new Date()) return { label: 'Expired', cls: 'badge-expired' };
    return { label: 'Open', cls: 'badge-open' };
  };

  if (showForm) {
    return <CampaignForm onCreated={refresh} onCancel={() => setShowForm(false)} />;
  }

  if (campaigns.length === 0) {
    return (
      <div className="campaigns-empty">
        <div className="campaigns-empty-icon">🏆</div>
        <p>No campaigns yet. Create your first hackathon or ideation campaign!</p>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>Create Campaign</button>
      </div>
    );
  }

  return (
    <div className="campaigns-list">
      <div className="campaigns-header">
        <h3>Campaigns ({campaigns.length})</h3>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ New</button>
      </div>
      {campaigns.map((c) => {
        const { label, cls } = getStatusLabel(c);
        return (
          <div key={c.id} className="campaign-card" onClick={() => onSelect(c)}>
            <div className="campaign-card-top">
              <span className="campaign-name">{c.name}</span>
              <span className={`campaign-badge ${cls}`}>{label}</span>
            </div>
            {c.description && <p className="campaign-desc">{c.description}</p>}
            <div className="campaign-meta">
              {c.endDate && <span>⏱️ {new Date(c.endDate).toLocaleDateString()}</span>}
              {c.prizes && <span>🎁 {c.prizes}</span>}
              <span className="campaign-date">Created {new Date(c.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
