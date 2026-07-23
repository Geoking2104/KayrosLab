const STORE_KEY = 'kayros_campaigns';

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : { campaigns: [], submissions: [] };
  } catch {
    return { campaigns: [], submissions: [] };
  }
}

function save(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

export function listCampaigns() {
  const { campaigns } = load();
  return campaigns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getCampaign(id) {
  const data = load();
  return data.campaigns.find((c) => c.id === id) || null;
}

export function createCampaign({ name, description, endDate, prizes }) {
  const data = load();
  const campaign = {
    id: crypto.randomUUID(),
    name,
    description,
    endDate: endDate || null,
    prizes: prizes || '',
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  data.campaigns.push(campaign);
  save(data);
  return campaign;
}

export function updateCampaign(id, fields) {
  const data = load();
  const c = data.campaigns.find((c) => c.id === id);
  if (!c) return null;
  Object.assign(c, fields);
  save(data);
  return c;
}

export function deleteCampaign(id) {
  const data = load();
  data.campaigns = data.campaigns.filter((c) => c.id !== id);
  data.submissions = data.submissions.filter((s) => s.campaignId !== id);
  save(data);
}

export function listSubmissions(campaignId) {
  const data = load();
  return data.submissions
    .filter((s) => s.campaignId === campaignId)
    .sort((a, b) => (b.ki || 0) - (a.ki || 0));
}

export function addSubmission({ campaignId, idea, author, ki, scores, competitors }) {
  const data = load();
  const submission = {
    id: crypto.randomUUID(),
    campaignId,
    idea,
    author,
    ki: ki || null,
    scores: scores || null,
    competitors: competitors || [],
    submittedAt: new Date().toISOString(),
  };
  data.submissions.push(submission);
  save(data);
  return submission;
}

export function removeSubmission(id) {
  const data = load();
  data.submissions = data.submissions.filter((s) => s.id !== id);
  save(data);
}
