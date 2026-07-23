export class GitLabScanner {
  constructor({ token, baseUrl = 'https://gitlab.com', fetchImpl } = {}) {
    this.token = token;
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('GitLabScanner: fetch implementation required');
  }

  _headers() {
    const h = { 'User-Agent': 'KayrosLab/1.0' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async search(query, { limit = 5 } = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const url = `${this.baseUrl}/api/v4/projects?search=${encodeURIComponent(q)}&per_page=${Math.min(limit, 20)}&order_by=stars&sort=desc`;
    const res = await this._fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`GitLab API: ${res.status}`);
    const items = await res.json();
    const results = [];
    for (const proj of items.slice(0, limit)) {
      results.push({
        name: proj.path_with_namespace || proj.name,
        url: proj.web_url || `${this.baseUrl}/${proj.path_with_namespace}`,
        description: proj.description || '',
        stars: proj.star_count,
        forks: proj.forks_count,
        language: proj.programming_language || null,
        topics: proj.topics || [],
        license: proj.license?.spdx_id || proj.license?.key || null,
        totalCommits: null,
        openIssues: proj.open_issues_count,
        lastRelease: null,
        contributors: null,
        lastPush: proj.last_activity_at || null,
        daysSinceLastPush: proj.last_activity_at ? Math.floor((Date.now() - new Date(proj.last_activity_at).getTime()) / 86400000) : null,
        visibility: proj.visibility,
        source: 'gitlab',
      });
    }
    return results;
  }
}
