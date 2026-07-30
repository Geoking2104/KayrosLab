// KayrosLab — Lightweight UI helpers for quant timeline + L0 canvas.
// Zero deps. Safe to embed in standalone HTML or React.

/** Compact badge for a quant key / recommendation. */
export function quantBadgeHtml(quantOrRec, { className = 'kayros-quant-badge' } = {}) {
  const quant = typeof quantOrRec === 'string' ? quantOrRec : quantOrRec?.quant;
  const tier = typeof quantOrRec === 'object' ? quantOrRec?.tier : null;
  const label = typeof quantOrRec === 'object' ? (quantOrRec?.meta?.label || quantOrRec?.label) : null;
  if (!quant) return '';
  const title = [tier && `tier:${tier}`, label].filter(Boolean).join(' · ');
  return `<span class="${className}" title="${escapeAttr(title)}" data-quant="${escapeAttr(quant)}">${escapeHtml(quant)}</span>`;
}

/** Render a single orchestrator event line with quant info. */
export function formatTraceLine(ev) {
  if (!ev || !ev.type) return '';
  if (ev.type === 'trace') {
    const model = ev.quant?.modelUsed || ev.quant?.agent?.preferredModel || '';
    const quant = ev.quant?.agent?.quant || '';
    const deg = ev.degraded ? ` ⚠ ${ev.degraded.reason}` : '';
    return `${ev.agent || '?'} · ${quant || '—'} · ${model || 'default'}${deg}`;
  }
  if (ev.type === 'start') {
    return `start · ${ev.quant?.resolvedDefaultModel || '—'}`;
  }
  if (ev.type === 'degraded') {
    return `degraded · ${ev.reason || ''} ${ev.from || ''} → ${ev.to || ''}`;
  }
  if (ev.type === 'distill') {
    return `distill · ${ev.count || 0} scénarios`;
  }
  return ev.type;
}

/** Build a simple HTML timeline from orchestrator events. */
export function quantTimelineHtml(events = [], { className = 'kayros-quant-timeline' } = {}) {
  const rows = events
    .filter((e) => e && ['start', 'trace', 'synthesis', 'distill', 'degraded', 'final'].includes(e.type))
    .map((e) => {
      const badge = e.quant?.agent
        ? quantBadgeHtml(e.quant.agent)
        : e.quant?.global
          ? quantBadgeHtml(e.quant.global)
          : '';
      return `<li data-type="${escapeAttr(e.type)}"><span class="ev-type">${escapeHtml(e.type)}</span> ${escapeHtml(formatTraceLine(e))} ${badge}</li>`;
    });
  return `<ul class="${className}">${rows.join('')}</ul>`;
}

/** Embed Mermaid from LayeredMemory.getWorkingCanvas(). */
export function mermaidCanvasHtml(canvas, { className = 'kayros-l0-canvas' } = {}) {
  if (!canvas?.mermaid) return '';
  const stats = canvas.stats
    ? `<div class="canvas-stats">L0: ${canvas.stats.total} · active ${canvas.stats.active} · offloaded ${canvas.stats.offloaded} · steps ${canvas.stats.steps}</div>`
    : '';
  return `<div class="${className}">${stats}<pre class="mermaid">${escapeHtml(canvas.mermaid)}</pre></div>`;
}

/** Controls snippet: autoDistill toggle + quant summary. */
export function quantControlsHtml({
  autoDistill = false,
  quantGuidance = null,
  idPrefix = 'kayros',
} = {}) {
  const globalQ = quantGuidance?.global?.quant || '—';
  const model = quantGuidance?.resolvedDefaultModel || '—';
  return `
<div class="${idPrefix}-quant-controls" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font:14px/1.4 system-ui,sans-serif">
  <label><input type="checkbox" id="${idPrefix}-auto-distill" ${autoDistill ? 'checked' : ''}/> autoDistill L1→L2</label>
  <span>quant global: <strong>${escapeHtml(globalQ)}</strong></span>
  <span>model: <code>${escapeHtml(model)}</code></span>
</div>`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
