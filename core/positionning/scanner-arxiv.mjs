import { XmlParser } from './_parse.mjs';

export class ArXivScanner {
  constructor({ fetchImpl } = {}) {
    this._fetch = fetchImpl ?? globalThis.fetch;
    if (!this._fetch) throw new Error('ArXivScanner: fetch implementation required');
  }

  async search(query, { limit = 5, sortBy = 'relevance' } = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const sortParam = sortBy === 'date' ? '&sortBy=submittedDate&sortOrder=desc' : '';
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${Math.min(limit, 50)}${sortParam}`;
    const res = await this._fetch(url, {
      headers: { 'User-Agent': 'KayrosLab/1.0' },
    });
    if (!res.ok) throw new Error(`ArXiv API: ${res.status}`);
    const xml = await res.text();
    return this._parseAtom(xml, limit);
  }

  _parseAtom(xml, limit) {
    const parser = new XmlParser(xml);
    const root = parser.parse();
    const entries = XmlParser.findByName(root, 'entry').slice(0, limit);
    return entries.map((entry) => {
      const id = XmlParser.firstText(entry, 'id') || '';
      const published = XmlParser.firstText(entry, 'published') || '';
      const updated = XmlParser.firstText(entry, 'updated') || '';
      const title = XmlParser.firstText(entry, 'title')?.replace(/\s+/g, ' ') || '';
      const summary = XmlParser.firstText(entry, 'summary')?.replace(/\s+/g, ' ') || '';
      const authors = XmlParser.findAllText(entry, 'name');
      const linkNodes = XmlParser.findByName(entry, 'link');
      const links = linkNodes.map((n) => n.attributes?.href || '');
      const pdfLink = links.find((l) => l.endsWith('.pdf')) || null;
      const absLink = links.find((l) => l.includes('/abs/')) || id;
      return {
        id: id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, ''),
        title,
        summary: summary.substring(0, 500),
        authors,
        published: published ? new Date(published).toISOString() : null,
        updated: updated ? new Date(updated).toISOString() : null,
        pdfUrl: pdfLink,
        absUrl: absLink,
        source: 'arxiv',
      };
    });
  }
}
