# apply-positioner-visual.ps1 - InfraNodus radar + detailed visual explanations
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out).Replace("`r`n","`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download visual patches..."
$fnNarrative = (Invoke-WebRequest "$Base/scripts/patches/narrativeFromPositioner.js" -UseBasicParsing).Content
$fnRender = (Invoke-WebRequest "$Base/scripts/patches/renderOntologyGraph.js" -UseBasicParsing).Content
$fnPanel = (Invoke-WebRequest "$Base/scripts/patches/buildOntologyPanel.js" -UseBasicParsing).Content
if ($fnRender -notmatch "Cluster entities by type") { throw "render patch invalid" }
if ($fnPanel -notmatch "howTitle") { throw "panel explanations missing - wait a few seconds and retry" }

function Replace-JsFunction([string]$src, [string]$name, [string]$body) {
  $start = $src.IndexOf("function $name")
  if ($start -lt 0) { return $null }
  $i = $src.IndexOf("{", $start)
  $depth = 0
  for ($j=$i; $j -lt $src.Length; $j++) {
    $c = $src[$j]
    if ($c -eq "{") { $depth++ }
    elseif ($c -eq "}") {
      $depth--
      if ($depth -eq 0) {
        return $src.Substring(0,$start) + $body.TrimEnd() + $src.Substring($j+1)
      }
    }
  }
  throw "end of $name not found"
}

Write-Host "3) Replace renderOntologyGraph..."
$r = Replace-JsFunction $raw "renderOntologyGraph" $fnRender
if ($null -eq $r) { throw "renderOntologyGraph not found" }
$raw = $r

Write-Host "4) Replace buildOntologyPanel..."
$r = Replace-JsFunction $raw "buildOntologyPanel" $fnPanel
if ($null -eq $r) { throw "buildOntologyPanel not found" }
$raw = $r

Write-Host "5) Inject/replace narrativeFromPositioner..."
if ($raw -notmatch "function narrativeFromPositioner") {
  $a = $raw.IndexOf("function normalizeOntologyMap")
  if ($a -lt 0) { throw "normalizeOntologyMap anchor missing" }
  $raw = $raw.Substring(0,$a) + $fnNarrative.TrimEnd() + "`n" + $raw.Substring($a)
} else {
  $r = Replace-JsFunction $raw "narrativeFromPositioner" $fnNarrative
  if ($null -ne $r) { $raw = $r }
}

Write-Host "6) Wire Positionner narrative (hide raw JSON)..."
if ($raw.IndexOf("narrativeFromPositioner(raw)") -lt 0) {
  $marker = "if (stepIdx === 3) {"
  $mi = $raw.IndexOf($marker)
  if ($mi -lt 0) { throw "stepIdx === 3 not found" }
  $insertAt = $mi + $marker.Length
  $inject = "`n      const narrative = narrativeFromPositioner(raw);`n      outputText = narrative;`n      contentHtml = markdownishToHtml(narrative);"
  $raw = $raw.Substring(0,$insertAt) + $inject + $raw.Substring($insertAt)
  $raw = $raw.Replace("outputText += '\n\n'+t('ontology_note',{},lang);", "")
}

Write-Host "7) i18n labels..."
$raw = [regex]::Replace($raw, "ontology_card:'R[^']*ontologie[^']*'", "ontology_card:'Radar concurrentiel et gap analysis'", 1)
$raw = $raw.Replace("ontology_card:'Ontology network (derived from the idea)'", "ontology_card:'Competitive radar and gap analysis'")

Write-Host "8) Sanity..."
foreach ($k in @("narrativeFromPositioner","Cluster entities by type","howTitle","details open")) {
  if ($raw.IndexOf($k) -lt 0) { throw "missing $k" }
}
Write-Host "   OK"

Write-Host "9) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
Write-Host ("   written {0} bytes" -f (Get-Item $Out).Length)
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="feat(demo): Positionner radar with detailed visual explanations"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
