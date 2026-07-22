const GITHUB_API = 'https://api.github.com';

export async function searchGitHub(idea, competitors) {
  const results = [];
  const names = competitors.map((c) => c.name);

  for (const name of names) {
    try {
      const repo = await findBestRepo(name, idea);
      if (repo) {
        const kpi = computeKPIs(repo);
        results.push({ competitor: name, repo: repo.full_name, kpi });
      }
    } catch (err) {
      console.warn(`[githubScanner] Failed for ${name}:`, err.message);
    }
  }
  return results;
}

async function findBestRepo(name, idea) {
  const query = encodeURIComponent(`${name} ${idea.split(' ').slice(0, 3).join(' ')}`);
  const res = await fetch(`${GITHUB_API}/search/repositories?q=${query}&sort=stars&per_page=3`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();

  const candidate = data.items?.[0];
  if (!candidate || candidate.stargazers_count < 5) return null;

  const issuesRes = await fetch(`${GITHUB_API}/search/issues?q=repo:${candidate.full_name}+type:issue&per_page=1`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  let openIssues = 0;
  let closedIssues = 0;
  if (issuesRes.ok) {
    const issueData = await issuesRes.json();
    openIssues = issueData.total_count || 0;
  }
  const closedRes = await fetch(`${GITHUB_API}/search/issues?q=repo:${candidate.full_name}+type:issue+state:closed&per_page=1`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (closedRes.ok) {
    const closedData = await closedRes.json();
    closedIssues = closedData.total_count || 0;
  }

  const commitsRes = await fetch(`${GITHUB_API}/repos/${candidate.full_name}/commits?per_page=1&since=${daysAgo(90)}`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  let recentCommits = 0;
  if (commitsRes.ok) {
    const link = commitsRes.headers.get('Link');
    if (link) {
      const match = link.match(/page=(\d+)>; rel="last"/);
      if (match) recentCommits = parseInt(match[1]) * 30;
    } else {
      recentCommits = (await commitsRes.json()).length;
    }
  }

  const contribRes = await fetch(`${GITHUB_API}/repos/${candidate.full_name}/contributors?per_page=1&anon=true`, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  let contributors = 0;
  if (contribRes.ok) {
    const link = contribRes.headers.get('Link');
    if (link) {
      const match = link.match(/page=(\d+)>; rel="last"/);
      if (match) contributors = parseInt(match[1]);
    } else {
      contributors = (await contribRes.json()).length;
    }
  }

  return {
    full_name: candidate.full_name,
    description: candidate.description || '',
    language: candidate.language || '',
    topics: candidate.topics || [],
    stargazers_count: candidate.stargazers_count,
    forks_count: candidate.forks_count,
    open_issues_count: candidate.open_issues_count,
    pushed_at: candidate.pushed_at,
    contributors,
    recentCommits,
    openIssues,
    closedIssues,
  };
}

function computeKPIs(repo) {
  const stars = Math.min(Math.log10(repo.stargazers_count + 1) / 4, 1) * 100;
  const forks = Math.min(Math.log10(repo.forks_count + 1) / 3, 1) * 100;
  const contribs = Math.min(Math.log10(repo.contributors + 1) / 2, 1) * 100;
  const totalIssues = repo.openIssues + repo.closedIssues;
  const closureRate = totalIssues > 0 ? (repo.closedIssues / totalIssues) * 100 : 50;
  const daysSincePush = (Date.now() - new Date(repo.pushed_at).getTime()) / 86400000;
  const recency = Math.max(0, 100 - daysSincePush / 3.65);
  const commit90d = repo.recentCommits ? Math.min(repo.recentCommits / 50, 1) * 100 : recency * 0.5;

  const composite = stars * 0.25 + forks * 0.15 + contribs * 0.15 + closureRate * 0.15 + commit90d * 0.15 + recency * 0.15;
  const inactive = daysSincePush > 365 ? -30 : 0;

  return {
    stars: Math.round(stars),
    forks: Math.round(forks),
    contributors: Math.round(contribs),
    closureRate: Math.round(closureRate),
    recency: Math.round(recency),
    commit90d: Math.round(commit90d),
    composite: Math.max(0, Math.min(100, Math.round(composite + inactive))),
    language: repo.language,
    topics: repo.topics,
    description: repo.description,
  };
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
