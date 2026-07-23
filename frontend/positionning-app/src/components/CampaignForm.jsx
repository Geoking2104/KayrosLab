import { useState } from 'react';
import { createCampaign } from '../data/campaignStore.js';

export default function CampaignForm({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [endDate, setEndDate] = useState('');
  const [prizes, setPrizes] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const campaign = createCampaign({
      name: name.trim(),
      description: description.trim(),
      endDate: endDate || null,
      prizes: prizes.trim(),
    });
    onCreated(campaign);
  };

  return (
    <form className="campaign-form" onSubmit={handleSubmit}>
      <h3>New Campaign</h3>
      <label>
        Name *
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. EdTech Hackathon 2026" required autoFocus />
      </label>
      <label>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Theme, rules, context..." />
      </label>
      <label>
        End Date
        <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label>
        Prizes
        <input type="text" value={prizes} onChange={(e) => setPrizes(e.target.value)} placeholder="e.g. 1st: 500€, 2nd: 200€" />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">Create</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
