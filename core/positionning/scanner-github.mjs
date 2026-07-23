function fetchWithTimeout(fetchFn, url, opts, timeoutMs = 8000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const signal = ctrl?.signal;
  const fetchOpts = signal ? { ...opts, signal } : opts;
  return fetchFn(url, fetchOpts).finally(() => { if (timer) clearTimeout(timer); });
}

export class GitHubScanner {
  constructor({ token, fetchImpl } = {}) {
    this.token = token;
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('GitHubScanner: fetch implementation required');
  }

  _headers() {
    const h = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'KayrosLab/1.0' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async search(query, { limit = 5 } = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${Math.min(limit, 20)}&sort=stars`;
    const res = await this._fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const data = await res.json();
    const items = data.items || [];
    const results = [];
    for (const repo of items.slice(0, limit)) {
      const kpis = await this._getRepoKPIs(repo.full_name);
      results.push({
        name: repo.full_name,
        url: repo.html_url,
        description: repo.description || '',
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        topics: repo.topics || [],
        license: repo.license?.spdx_id || null,
        ...kpis,
        source: 'github',
      });
    }
    return results;
  }

  async _getRepoKPIs(fullName) {
    const h = this._headers();
    const f = (url) => fetchWithTimeout(this._fetch, url, { headers: h });

    const [commitsR, issuesR, releasesR, repoR, contribR] = await Promise.allSettled([
      f(`https://api.github.com/repos/${fullName}/commits?per_page=1`).then((r) => ({ res: r })),
      f(`https://api.github.com/repos/${fullName}/issues?state=open&per_page=1`).then((r) => ({ res: r })),
      f(`https://api.github.com/repos/${fullName}/releases?per_page=1`).then((r) => ({ res: r })),
      f(`https://api.github.com/repos/${fullName}`).then((r) => ({ res: r })),
      f(`https://api.github.com/repos/${fullName}/contributors?per_page=1&anon=true`).then((r) => ({ res: r })),
    ]);

    const safeJson = async (result) => {
      if (result?.status !== 'fulfilled' || !result.value?.res?.ok) return null;
      try { return await result.value.res.json(); } catch { return null; }
    };
    const linkVal = (result) => {
      if (result?.status !== 'fulfilled' || !result.value?.res?.ok) return '';
      return result.value.res.headers.get('link') || '';
    };
    const lastPage = (link) => {
      if (!link) return null;
      const m = link.match(/page=(\d+)>; rel="last"/);
      return m ? parseInt(m[1], 10) : null;
    };

    const totalCommits = lastPage(linkVal(commitsR));
    const openIssues = lastPage(linkVal(issuesR));
    const releasesData = await safeJson(releasesR);
    const lastRelease = releasesData?.[0]?.tag_name || null;
    const repoData = await safeJson(repoR);
    const lastPush = repoData?.pushed_at || null;
    const daysSinceLastPush = lastPush ? Math.floor((Date.now() - new Date(lastPush).getTime()) / 86400000) : null;
    const contributors = lastPage(linkVal(contribR));

    return { totalCommits, openIssues, lastRelease, contributors, lastPush, daysSinceLastPush };
  }
}
