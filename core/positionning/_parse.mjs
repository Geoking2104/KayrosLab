export class XmlParser {
  constructor(xml) {
    this.xml = String(xml ?? '');
    this.pos = 0;
  }

  skipWhitespace() {
    while (this.pos < this.xml.length && /\s/.test(this.xml[this.pos])) this.pos++;
  }

  peek() { return this.xml[this.pos]; }

  consume() { return this.xml[this.pos++]; }

  match(expected) {
    if (this.xml.startsWith(expected, this.pos)) { this.pos += expected.length; return true; }
    return false;
  }

  readUntil(stop) {
    const start = this.pos;
    while (this.pos < this.xml.length && !this.xml.startsWith(stop, this.pos)) this.pos++;
    return this.xml.slice(start, this.pos);
  }

  parseTagName() {
    this.skipWhitespace();
    let name = '';
    while (this.pos < this.xml.length && /[a-zA-Z_:]/.test(this.peek())) {
      name += this.consume();
    }
    while (this.pos < this.xml.length && /[a-zA-Z0-9_:.\-]/.test(this.peek())) {
      name += this.consume();
    }
    return name;
  }

  parseAttributes() {
    const attrs = {};
    this.skipWhitespace();
    while (this.pos < this.xml.length && !this.match('>') && !this.match('/>')) {
      this.skipWhitespace();
      let name = '';
      while (this.pos < this.xml.length && /[a-zA-Z_:]/.test(this.peek())) { name += this.consume(); }
      while (this.pos < this.xml.length && /[a-zA-Z0-9_:.\-]/.test(this.peek())) { name += this.consume(); }
      this.skipWhitespace();
      if (this.match('=')) {
        this.skipWhitespace();
        const quote = this.peek();
        if (quote === '"' || quote === "'") {
          this.consume();
          let val = '';
          while (this.pos < this.xml.length && this.peek() !== quote) val += this.consume();
          if (this.peek() === quote) this.consume();
          attrs[name] = val;
        }
      }
      this.skipWhitespace();
    }
    if (this.xml[this.pos - 1] !== '>') this.consume();
    return attrs;
  }

  parseChildren(stopTag) {
    const children = [];
    while (this.pos < this.xml.length) {
      this.skipWhitespace();
      if (this.match('</')) {
        this.readUntil('>'); this.consume();
        return children;
      }
      if (this.match('<!--')) {
        this.readUntil('-->'); this.match('-->');
        continue;
      }
      if (this.match('<![CDATA[')) {
        const start = this.pos;
        this.readUntil(']]>'); this.match(']]>');
        children.push({ type: 'text', value: this.xml.slice(start, this.pos - 3) });
        continue;
      }
      if (this.peek() === '<') {
        const child = this.parseElement();
        if (child) children.push(child);
      } else {
        const text = this.readUntil('<').replace(/\s+/g, ' ').trim();
        if (text) children.push({ type: 'text', value: text });
      }
    }
    return children;
  }

  parseElement() {
    if (!this.match('<')) return null;
    if (this.match('/') || this.match('?') || this.match('!')) {
      this.readUntil('>'); this.consume();
      return this.parseElement();
    }
    const name = this.parseTagName();
    if (!name) return null;
    const attributes = this.parseAttributes();
    if (this.xml[this.pos - 1] === '/' && this.xml[this.pos - 2] === '/') {
      return { type: 'element', name, attributes, children: [] };
    }
    this.skipWhitespace();
    const children = this.parseChildren(name);
    return { type: 'element', name, attributes, children };
  }

  parse() {
    const root = this.parseElement();
    return root;
  }

  static textContent(node) {
    if (!node) return '';
    if (node.type === 'text') return node.value;
    if (node.children) return node.children.map((c) => XmlParser.textContent(c)).join(' ').replace(/\s+/g, ' ').trim();
    return '';
  }

  static findByName(node, name) {
    if (!node || !node.children) return [];
    const results = [];
    for (const child of node.children) {
      if (child.type === 'element' && child.name === name) results.push(child);
      results.push(...XmlParser.findByName(child, name));
    }
    return results;
  }

  static findChild(node, name) {
    if (!node?.children) return null;
    return node.children.find((c) => c.type === 'element' && c.name === name) || null;
  }

  static findAllText(node, tag) {
    const elements = XmlParser.findByName(node, tag);
    return elements.map((el) => XmlParser.textContent(el));
  }

  static firstText(node, tag) {
    const el = XmlParser.findChild(node, tag) || XmlParser.findByName(node, tag)[0];
    return XmlParser.textContent(el);
  }
}

export class HtmlTableParser {
  constructor(html) {
    this.html = String(html ?? '');
    this.pos = 0;
  }

  skipWhitespace() {
    while (this.pos < this.html.length && /\s/.test(this.html[this.pos])) this.pos++;
  }

  match(expected) {
    if (this.html.startsWith(expected, this.pos)) { this.pos += expected.length; return true; }
    return false;
  }

  readTagContent() {
    let depth = 1;
    const start = this.pos;
    while (this.pos < this.html.length && depth > 0) {
      if (this.html[this.pos] === '<') {
        if (this.match('</')) { this.readUntil('>'); this.consume(); depth--; }
        else { const end = this.html.indexOf('>', this.pos); if (end >= 0) { this.pos = end + 1; depth++; } else { this.pos++; } }
      } else { this.pos++; }
    }
    return this.html.slice(start, this.pos).trim();
  }

  parseTableRows() {
    const rows = [];
    let row = { cells: [] };
    let inTr = false, inTd = false;
    let i = 0;
    while (i < this.html.length) {
      const rest = this.html.slice(i);
      const trStart = rest.indexOf('<tr');
      const tdStart = rest.indexOf('<td');
      const trEnd = rest.indexOf('</tr>');
      const tdEnd = rest.indexOf('</td>');

      if (!inTr && trStart >= 0 && (tdStart < 0 || trStart < tdStart)) {
        inTr = true; row = { cells: [] };
        i += trStart + 3;
      } else if (inTr && !inTd && tdStart >= 0 && tdStart < (trEnd >= 0 ? trEnd : Infinity)) {
        inTd = true;
        const tdClose = rest.indexOf('</td>', tdStart);
        const content = tdClose >= 0 ? rest.slice(tdStart + 3, tdClose).trim() : '';
        row.cells.push(content);
        i += (tdClose >= 0 ? tdClose + 5 : rest.length);
        inTd = false;
      } else if (inTr && trEnd >= 0 && trEnd < (tdStart >= 0 ? tdStart : Infinity)) {
        rows.push(row); inTr = false;
        i += trEnd + 5;
      } else { i++; }
    }
    return rows;
  }

  static parseLinks(html) {
    const results = [];
    let re = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      results.push({ href: m[1], text: m[2].replace(/<[^>]*>/g, '').trim() });
    }
    return results;
  }

  static extractSnippets(html) {
    const results = [];
    let re = /class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      results.push(m[1].replace(/<[^>]*>/g, '').trim());
    }
    return results;
  }
}
