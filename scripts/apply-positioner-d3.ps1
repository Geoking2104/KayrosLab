# apply-positioner-d3.ps1 - D3.js force graph for Positionner
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out).Replace("`r`n","`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download D3 mount + panel patches..."
$fnD3 = (Invoke-WebRequest "$Base/scripts/patches/mountOntologyD3.js" -UseBasicParsing).Content
if ($fnD3 -notmatch "forceSimulation") { throw "D3 mount patch invalid" }
$fnPanel = $null
try {
  $fnPanel = (Invoke-WebRequest "$Base/scripts/patches/buildOntologyPanel.js" -UseBasicParsing).Content
  if ($fnPanel -notmatch "howTitle") { $fnPanel = $null }
} catch { $fnPanel = $null }
$fnRender = $null
try {
  $fnRender = (Invoke-WebRequest "$Base/scripts/patches/renderOntologyGraph.js" -UseBasicParsing).Content
  if ($fnRender -notmatch "Cluster entities by type") { $fnRender = $null }
} catch { $fnRender = $null }
$fnNarrative = $null
try { $fnNarrative = (Invoke-WebRequest "$Base/scripts/patches/narrativeFromPositioner.js" -UseBasicParsing).Content } catch {}

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

Write-Host "3) Add D3.js CDN..."
if ($raw -notmatch "d3@7") {
  $raw = $raw.Replace(
    '<script src="https://cdn.tailwindcss.com"',
    '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>' + "`n" + '<script src="https://cdn.tailwindcss.com"'
  )
}

Write-Host "4) Optional enhanced panel/render/narrative..."
if ($fnRender) {
  $r = Replace-JsFunction $raw "renderOntologyGraph" $fnRender
  if ($null -ne $r) { $raw = $r }
}
if ($fnPanel) {
  # force D3 root inside panel
  $panel = $fnPanel -replace "<svg id=`"ontology-graph`"[^']*'>'\+renderOntologyGraph\(map\)\+'</svg>", "<div id=`"ontology-d3-root`" class=`"w-full min-h-[400px]`"></div>"
  if ($panel -notmatch "ontology-d3-root") {
    $panel = $fnPanel.Replace(
      "'+renderOntologyGraph(map)+'</svg>';",
      "'</svg><div id=`"ontology-d3-root`" class=`"w-full min-h-[400px] mt-1`"></div>';"
    )
  }
  $r = Replace-JsFunction $raw "buildOntologyPanel" $panel
  if ($null -ne $r) { $raw = $r; Write-Host "   panel OK" }
}
if ($fnNarrative -and $raw -notmatch "function narrativeFromPositioner") {
  $a = $raw.IndexOf("function normalizeOntologyMap")
  if ($a -ge 0) { $raw = $raw.Substring(0,$a) + $fnNarrative.TrimEnd() + "`n" + $raw.Substring($a) }
}
if ($raw.IndexOf("narrativeFromPositioner(raw)") -lt 0 -and $raw -match "function narrativeFromPositioner") {
  $marker = "if (stepIdx === 3) {"
  $mi = $raw.IndexOf($marker)
  if ($mi -ge 0) {
    $insertAt = $mi + $marker.Length
    $inject = "`n      const narrative = narrativeFromPositioner(raw);`n      outputText = narrative;`n      contentHtml = markdownishToHtml(narrative);"
    $raw = $raw.Substring(0,$insertAt) + $inject + $raw.Substring($insertAt)
    $raw = $raw.Replace("outputText += '\n\n'+t('ontology_note',{},lang);", "")
  }
}

Write-Host "5) Inject mountOntologyD3..."
if ($raw -notmatch "function mountOntologyD3") {
  $a = $raw.IndexOf("function buildOntologyPanel")
  if ($a -lt 0) { $a = $raw.IndexOf("function renderOntologyGraph") }
  if ($a -lt 0) { throw "anchor missing" }
  $raw = $raw.Substring(0,$a) + $fnD3.TrimEnd() + "`n" + $raw.Substring($a)
}

Write-Host "6) Ensure ontology-d3-root exists in panel strings..."
if ($raw.IndexOf("ontology-d3-root") -lt 0) {
  $raw = $raw.Replace(
    "'+renderOntologyGraph(map)+'</svg>';",
    "'</svg><div id=`"ontology-d3-root`" class=`"w-full min-h-[400px]`"></div>';"
  )
}
if ($raw.IndexOf("ontology-d3-root") -lt 0) { throw "ontology-d3-root not injected" }

Write-Host "7) Schedule D3 mount after DOM inject..."
$needle = "document.getElementById('generated-content').innerHTML = contentHtml;"
if ($raw.IndexOf("scheduleOntologyD3Mount()") -lt 0) {
  if ($raw.IndexOf($needle) -lt 0) { throw "generated-content inject not found" }
  $raw = $raw.Replace($needle, $needle + "`n  scheduleOntologyD3Mount();")
}

Write-Host "8) Sanity..."
foreach ($k in @("d3@7","mountOntologyD3","forceSimulation","scheduleOntologyD3Mount","ontology-d3-root")) {
  if ($raw.IndexOf($k) -lt 0) { throw "missing $k" }
}
Write-Host "   OK"

Write-Host "9) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
Write-Host ("   written {0} bytes" -f (Get-Item $Out).Length)
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="feat(demo): D3.js force-directed graph for Positionner ontology radar"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
