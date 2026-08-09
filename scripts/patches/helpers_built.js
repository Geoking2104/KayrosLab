
const STEP_JSON_HINT = {
  0: null, 1: null,
  2: '{"scenarios":[{"id":"s1","name":"","thesis":"","feasibility":1,"horizon":"","falsifiable_hypothesis":"","first_test":""}]}',
  3: null,
  4: '{"risks":[{"id":"r1","label":"","severity":1,"likelihood":1,"ki_impact":"","mitigation":""}],"kill_criteria":[],"decisive_attack":"","noise_attacks":[]}',
  5: '{"ki_score":1,"ki_rationale":"","recommendation":"go|conditional_go|no_go","go_conditions":[],"no_go_conditions":[],"main_counterargument":"","open_questions_for_human":[]}',
  6: null, 7: null
};
function withJsonHint(systemPrompt, stepIdx, lang){
  const hint = STEP_JSON_HINT[stepIdx];
  if(!hint) return systemPrompt;
  const extra = lang==='en'
    ? '\nIf helpful, end with a single valid JSON object matching: '+hint+'. No markdown fences.'
    : '\nSi utile, termine par un objet JSON unique valide du schema : '+hint+'. Pas de fences markdown.';
  return systemPrompt + extra;
}
function normalizeScenariosMap(raw){
  const parsed = extractJsonValue(raw);
  const list = Array.isArray(parsed) ? parsed : (parsed.scenarios || parsed.variants || []);
  if(!Array.isArray(list) || list.length < 2) throw new Error('scenarios');
  return { scenarios: list.slice(0,3).map(function(s,i){
    return { id:String(s.id||('s'+(i+1))), name:String(s.name||s.title||('Scenario '+(i+1))).trim(),
      thesis:String(s.thesis||s.summary||'').trim(), feasibility:Math.max(1,Math.min(10,Number(s.feasibility||s.score||5))),
      horizon:String(s.horizon||'').trim(), falsifiable_hypothesis:String(s.falsifiable_hypothesis||s.hypothesis||'').trim(),
      first_test:String(s.first_test||s.test||'').trim() };
  })};
}
function buildScenariosPanel(map, lang){
  var h = '<div class="mt-4 pt-3 border-t border-slate-200"><p class="text-xs font-semibold text-slate-700 mb-1">'+escapeHtml(t('panel_scenarios',{},lang))+'</p>';
  h += '<div class="grid sm:grid-cols-3 gap-3">';
  map.scenarios.forEach(function(s){
    h += '<div class="rounded-xl border border-slate-200 bg-white p-3 text-sm"><div class="flex justify-between mb-1"><span class="font-semibold">'+escapeHtml(s.name)+'</span><span class="text-[10px] font-bold text-sky-700">'+s.feasibility+'/10</span></div>';
    if(s.thesis) h += '<p class="text-xs text-slate-600">'+escapeHtml(s.thesis)+'</p>';
    h += '</div>';
  });
  return h+'</div></div>';
}
function normalizeRiskMap(raw){
  const parsed = extractJsonValue(raw);
  const list = Array.isArray(parsed) ? parsed : (parsed.risks || []);
  if(!Array.isArray(list) || !list.length) throw new Error('risks');
  return {
    risks: list.slice(0,5).map(function(r,i){ return { id:String(r.id||('r'+(i+1))), label:String(r.label||r.title||'').trim(), severity:Math.max(1,Math.min(10,Number(r.severity||5))), likelihood:Math.max(1,Math.min(10,Number(r.likelihood||5))), ki_impact:String(r.ki_impact||'').trim(), mitigation:String(r.mitigation||'').trim() }; }).filter(function(r){return r.label;}),
    kill_criteria: Array.isArray(parsed.kill_criteria)?parsed.kill_criteria.map(String).filter(Boolean).slice(0,4):[],
    decisive_attack: String(parsed.decisive_attack||'').trim()
  };
}
function buildRiskPanel(map, lang){
  var h = '<div class="mt-4 pt-3 border-t border-slate-200"><p class="text-xs font-semibold text-slate-700 mb-1">'+escapeHtml(t('panel_risks',{},lang))+'</p><div class="space-y-2">';
  map.risks.forEach(function(r){
    h += '<div class="rounded-xl border border-rose-100 bg-rose-50/40 p-3 text-sm"><div class="flex justify-between"><span class="font-semibold">'+escapeHtml(r.label)+'</span><span class="text-[10px] text-rose-700">S'+r.severity+' / L'+r.likelihood+'</span></div>';
    if(r.mitigation) h += '<p class="text-[11px] text-emerald-800 mt-1">'+escapeHtml(r.mitigation)+'</p>';
    h += '</div>';
  });
  h += '</div>';
  if(map.kill_criteria.length){ h += '<p class="text-xs font-semibold text-rose-800 mt-2">'+escapeHtml(t('kill_criteria_label',{},lang))+'</p><ul class="list-disc pl-5 text-xs">'; map.kill_criteria.forEach(function(k){ h+='<li>'+escapeHtml(k)+'</li>'; }); h+='</ul>'; }
  return h+'</div>';
}
function normalizeDecisionMap(raw){
  const parsed = extractJsonValue(raw);
  if(typeof parsed !== 'object' || !parsed || Array.isArray(parsed)) throw new Error('decision');
  const rec = String(parsed.recommendation||parsed.decision||'').toLowerCase().replace(/\s+/g,'_');
  var recommendation = 'conditional_go';
  if(/no[_-]?go/.test(rec)) recommendation = 'no_go';
  else if(rec === 'go') recommendation = 'go';
  return { ki_score:Math.max(1,Math.min(10,Number(parsed.ki_score||parsed.ki||5))), ki_rationale:String(parsed.ki_rationale||'').trim(), recommendation:recommendation,
    go_conditions:Array.isArray(parsed.go_conditions)?parsed.go_conditions.map(String).filter(Boolean):[],
    no_go_conditions:Array.isArray(parsed.no_go_conditions)?parsed.no_go_conditions.map(String).filter(Boolean):[],
    main_counterargument:String(parsed.main_counterargument||'').trim(),
    open_questions_for_human:Array.isArray(parsed.open_questions_for_human)?parsed.open_questions_for_human.map(String).filter(Boolean):[] };
}
function buildDecisionPanel(map, lang){
  var recLabel = map.recommendation==='go'?'GO':(map.recommendation==='no_go'?'NO-GO':'GO conditionnel');
  var recClass = map.recommendation==='go'?'bg-emerald-100 text-emerald-800':(map.recommendation==='no_go'?'bg-rose-100 text-rose-800':'bg-amber-100 text-amber-900');
  var h = '<div class="mt-4 pt-3 border-t border-slate-200"><p class="text-xs font-semibold text-slate-700 mb-1">'+escapeHtml(t('panel_decision',{},lang))+'</p>';
  h += '<div class="flex gap-3 mb-2"><div class="rounded-xl border px-4 py-3"><div class="text-[10px] text-slate-500">'+escapeHtml(t('ki_label',{},lang))+'</div><div class="text-2xl font-bold">'+map.ki_score+'<span class="text-sm text-slate-400">/10</span></div></div>';
  h += '<div class="rounded-xl border px-4 py-3"><div class="text-[10px] text-slate-500">'+escapeHtml(t('recommendation_label',{},lang))+'</div><div class="mt-1 inline-flex text-sm font-bold px-2 py-1 rounded-full '+recClass+'">'+escapeHtml(recLabel)+'</div></div></div>';
  if(map.ki_rationale) h += '<p class="text-xs text-slate-600">'+escapeHtml(map.ki_rationale)+'</p>';
  return h+'</div>';
}
