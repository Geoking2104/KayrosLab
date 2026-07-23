import { XmlParser } from './_parse.mjs';

export class WebScanner {
  constructor({ googleApiKey, googleCx, fetchImpl } = {}) {
    this.googleApiKey = googleApiKey;
    this.googleCx = googleCx;
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('WebScanner: fetch implementation required');
  }

  async search(query, { limit = 5, provider } = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];

    if (provider === 'google' || (this.googleApiKey && this.googleCx)) {
      try {
        return await this._searchGoogle(q, limit);
      } catch (e) {
        if (provider === 'google') throw e;
      }
    }
    return this._searchDuckDuckGo(q, limit);
  }

  async _searchGoogle(q, limit) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${this.googleApiKey}&cx=${this.googleCx}&q=${encodeURIComponent(q)}&num=${Math.min(limit, 10)}`;
    const res = await this._fetch(url);
    if (!res.ok) throw new Error(`Google Search API: ${res.status}`);
    const data = await res.json();
    return (data.items || []).map((item) => ({
      name: item.title,
      url: item.link,
      snippet: item.snippet || '',
      source: 'google',
    }));
  }

  _parseDuckDuckGoHtml(html, limit) {
    const results = [];
    let pos = 0;
    let current = null;

    while (pos < html.length && results.length < limit) {
      const trStart = html.indexOf('<tr', pos);
      if (trStart < 0) break;
      const trEnd = html.indexOf('</tr>', trStart);
      if (trEnd < 0) break;
      const block = html.slice(trStart, trEnd + 5);
      pos = trEnd + 5;

      const isLink = /class=["']result-link["']/i.test(block);
      const isSnippet = /class=["']result-snippet["']/i.test(block);

      if (isLink) {
        if (current) { results.push(current); if (results.length >= limit) break; }
        const parser = new XmlParser(block);
        const root = parser.parse();
        const links = XmlParser.findByName(root, 'a');
        if (links.length > 0) {
          const href = links[0].attributes?.href || '';
          const text = XmlParser.textContent(links[0]);
          current = { name: text, url: href.split('?')[0], snippet: '', source: 'duckduckgo' };
        }
      } else if (current && isSnippet) {
        const m = block.match(/class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/i);
        if (m) current.snippet = m[1].replace(/<[^>]*>/g, '').trim();
        results.push(current);
        current = null;
      }
    }
    if (current) results.push(current);
    return results;
  }

  async _searchDuckDuckGo(q, limit) {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
    const res = await this._fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KayrosLab/1.0)' },
    });
    if (!res.ok) throw new Error(`DuckDuckGo: ${res.status}`);
    const html = await res.text();
    return this._parseDuckDuckGoHtml(html, limit);
  }
}
