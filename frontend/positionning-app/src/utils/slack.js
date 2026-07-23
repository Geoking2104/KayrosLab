export async function sendToSlack(webhookUrl, { idea, ki, competitors, gaps }) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🧪 KayrosLab Analysis${ki !== null ? ` — KI ${ki}/100` : ''}`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Idea:*\n${idea.slice(0, 500)}` },
    },
  ];

  if (competitors && competitors.length > 0) {
    const top = competitors.slice(0, 5);
    const lines = top.map((c) => `• *${c.name}* — ${c.avgScore}/100`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Competitors (${competitors.length}):*\n${lines}` },
    });
  }

  if (gaps && gaps.length > 0) {
    const topGaps = gaps.slice(0, 5);
    const gapLines = topGaps.map((g) => `• ${g.icon || '📊'} ${g.entityName || g.neuronId}: *${g.diff > 0 ? '+' : ''}${g.diff}* (${g.type === 'advantage' ? 'Advantage' : 'Disadvantage'})`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Gaps:*\n${gapLines}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `KayrosLab · ${new Date().toISOString().slice(0, 10)}` }],
  });

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks, text: `KayrosLab Analysis — KI ${ki ?? '?'}/100` }),
  });

  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
  return true;
}
