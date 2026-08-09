# KayrosLab apply-demo-patch.ps1 - downloads base + patches from GitHub, applies, pushes
$ErrorActionPreference = "Stop"
$Owner = "Geoking2104"; $Repo = "KayrosLab"
$Path  = "kayroslab-complete-with-ai-agents.html"
$Out   = Join-Path $env:TEMP $Path
$GoodCommit = "0cf944b01cd0e4564de05dc8f72ad18c88247b49"
$RawBase = "https://raw.githubusercontent.com/$Owner/$Repo"

Write-Host "1) Download last good HTML..."
Invoke-WebRequest "$RawBase/$GoodCommit/$Path" -OutFile $Out -UseBasicParsing
$raw = [IO.File]::ReadAllText($Out).Replace("`r`n", "`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download patches from main..."
$newCycle = (Invoke-WebRequest "$RawBase/main/scripts/patches/new_cycle.js" -UseBasicParsing).Content
$helpers  = (Invoke-WebRequest "$RawBase/main/scripts/patches/helpers_built.js" -UseBasicParsing).Content
if ($newCycle -notmatch "GENUINELY") { throw "cycle patch invalid" }
if ($helpers -notmatch "withJsonHint") { throw "helpers patch invalid" }
Write-Host ("   cycle {0} helpers {1}" -f $newCycle.Length, $helpers.Length)

Write-Host "3) Replace cycleData..."
$cdStart = $raw.IndexOf("const cycleData = [")
$cdEnd   = $raw.IndexOf("const stepMeta = [")
if ($cdStart -lt 0 -or $cdEnd -lt 0) { throw "cycleData/stepMeta not found" }
$raw = $raw.Substring(0, $cdStart) + $newCycle.TrimEnd() + "`n" + $raw.Substring($cdEnd)

Write-Host "4) i18n panel keys..."
if ($raw -notmatch "panel_scenarios:") {
  $raw = $raw.Replace(
    "user_action_input:'Action et saisie utilisateur'",
    "user_action_input:'Action et saisie utilisateur',`n    panel_scenarios:'Scenarios a arbitrer',`n    panel_scenarios_hint:'Gardez 1 ou 2 scenarios pour la suite.',`n    panel_risks:'Risques prioritaires (Red Team)',`n    panel_risks_hint:'Les kill criteria alimentent le gate humain.',`n    panel_decision:'Dossier d arbitrage',`n    panel_decision_hint:'La recommandation aide - le COMEX tranche.',`n    panel_no_json:'Sortie non structuree - le texte reste la reference.',`n    ki_label:'Score KI',`n    recommendation_label:'Recommandation',`n    kill_criteria_label:'Kill criteria'"
  )
  $raw = $raw.Replace(
    "user_action_input:'User action and input'",
    "user_action_input:'User action and input',`n    panel_scenarios:'Scenarios to decide on',`n    panel_scenarios_hint:'Keep 1 or 2 scenarios for the next steps.',`n    panel_risks:'Priority risks (Red Team)',`n    panel_risks_hint:'Kill criteria feed the human gate.',`n    panel_decision:'Arbitration pack',`n    panel_decision_hint:'The recommendation supports - executives decide.',`n    panel_no_json:'Unstructured output - the text remains the reference.',`n    ki_label:'KI score',`n    recommendation_label:'Recommendation',`n    kill_criteria_label:'Kill criteria'"
  )
}

Write-Host "5) Inject helpers..."
$bp = $raw.IndexOf("function buildUserPrompt")
if ($bp -lt 0) { throw "buildUserPrompt not found" }
if ($raw -notmatch "function withJsonHint") {
  $raw = $raw.Substring(0, $bp) + $helpers.TrimEnd() + "`n" + $raw.Substring($bp)
}

Write-Host "6) Wire API call..."
$oldCall = "const raw = await callMistralViaProxy(data.system[lang]||data.system.fr, buildUserPrompt(demoState.idea, demoState.conditions, notes, lang));"
$newCall = "const sys = withJsonHint(data.system[lang]||data.system.fr, stepIdx, lang);`n    const raw = await callMistralViaProxy(sys, buildUserPrompt(demoState.idea, demoState.conditions, notes, lang));"
if (-not $raw.Contains($oldCall)) { throw "API call pattern not found" }
$raw = $raw.Replace($oldCall, $newCall)

Write-Host "7) Wire panels (step 2/3/4/5)..."
$marker = "if (stepIdx === 3) {"
$idx = $raw.IndexOf($marker)
if ($idx -lt 0) { throw "stepIdx === 3 block not found" }
# Find end of this single if block roughly - insert before it
$insert = @"
    if (stepIdx === 2) {
      try {
        const smap = normalizeScenariosMap(raw);
        demoState.scenariosMap = smap;
        contentHtml += buildScenariosPanel(smap, lang);
        log('Scenarios: '+smap.scenarios.length, 'success');
      } catch (serr) {
        contentHtml += '<div class="mt-4 pt-3 border-t border-slate-200 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">'+escapeHtml(t('panel_no_json',{},lang))+'</div>';
        log('Scenarios parse fallback: '+serr.message, 'warn');
      }
    }
"@
if ($raw -notmatch "stepIdx === 2") {
  $raw = $raw.Substring(0, $idx) + $insert + $raw.Substring($idx)
}
# After ontology block, add risk + decision if missing
if ($raw -notmatch "normalizeRiskMap") {
  $ontoEnd = $raw.IndexOf("Ontology parse fallback")
  if ($ontoEnd -lt 0) { throw "ontology block end not found" }
  # find closing of that catch/if after ontoEnd
  $searchFrom = $ontoEnd
  $closeIdx = $raw.IndexOf("`n    }`n", $searchFrom)
  if ($closeIdx -lt 0) { $closeIdx = $raw.IndexOf("`n    }", $searchFrom) }
  $closeIdx = $raw.IndexOf("`n", $closeIdx + 1)
  $extra = @"

    if (stepIdx === 4) {
      try {
        const rmap = normalizeRiskMap(raw);
        demoState.riskMap = rmap;
        contentHtml += buildRiskPanel(rmap, lang);
        log('Risks: '+rmap.risks.length, 'success');
      } catch (rerr) {
        contentHtml += '<div class="mt-4 pt-3 border-t border-slate-200 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">'+escapeHtml(t('panel_no_json',{},lang))+'</div>';
        log('Risks parse fallback: '+rerr.message, 'warn');
      }
    }
    if (stepIdx === 5) {
      try {
        const dmap = normalizeDecisionMap(raw);
        demoState.decisionMap = dmap;
        contentHtml += buildDecisionPanel(dmap, lang);
        log('Decision: KI='+dmap.ki_score, 'success');
      } catch (derr) {
        contentHtml += '<div class="mt-4 pt-3 border-t border-slate-200 text-xs text-amber-700 bg-amber-50 rounded-lg p-3">'+escapeHtml(t('panel_no_json',{},lang))+'</div>';
        log('Decision parse fallback: '+derr.message, 'warn');
      }
    }
"@
  $raw = $raw.Substring(0, $closeIdx) + $extra + $raw.Substring($closeIdx)
}

Write-Host "8) Sanity..."
if ($raw -notmatch "GENUINELY") { throw "prompts missing" }
if ($raw -notmatch "function withJsonHint") { throw "withJsonHint missing" }
Write-Host "   OK"

Write-Host "9) Push to GitHub..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
Write-Host ("   written {0} bytes" -f (Get-Item $Out).Length)
$b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta = gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{
  message = "feat(demo): framework prompts + JSON panels Build/Challenge/Decide"
  content = $b64
  branch  = "main"
  sha     = $meta.sha
} | ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE."
Write-Host "https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
