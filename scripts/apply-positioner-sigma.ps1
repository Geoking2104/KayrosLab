# apply-positioner-sigma.ps1 - Sigma.js network graph for Positionner
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out).Replace("`r`n","`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download Sigma mount + panel patches..."
$fnSigma = (Invoke-WebRequest "$Base/scripts/patches/mountOntologySigma.js" -UseBasicParsing).Content
if ($fnSigma -notmatch "mountOntologySigma") { throw "Sigma patch invalid" }

$fnPanel = $null
try {
  $fnPanel = (Invoke-WebRequest "$Base/scripts/patches/buildOntologyPanel.js" -UseBasicParsing).Content
  if ($fnPanel -notmatch "howTitle") { $fnPanel = $null }
} catch {}
$fnRender = $null
try {
  $fnRender = (Invoke-WebRequest "$Base/scripts/patches/renderOntologyGraph.js" -UseBasicParsing).Content
  if ($fnRender -notmatch "Cluster entities by type") { $fnRender = $null }
} catch {}
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

Write-Host "3) Add Graphology + Sigma.js CDN..."
if ($raw -notmatch "sigma@") {
  $cdn = '<script src="https://cdn.jsdelivr.net/npm/graphology@0.25.4/dist/graphology.umd.min.js"></script>' + "`n" +
         '<script src="https://cdn.jsdelivr.net/npm/sigma@2.4.0/sigma.min.js"></script>'
  if ($raw -match "d3@7") {
    $raw = $raw.Replace(
      '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/d3@7"></script>' + "`n" + $cdn
    )
  } else {
    $raw = $raw.Replace(
      '<script src="https://cdn.tailwindcss.com"',
      $cdn + "`n" + '<script src="https://cdn.tailwindcss.com"'
    )
  }
}

Write-Host "4) Optional panel / render / narrative..."
if ($fnRender) {
  $r = Replace-JsFunction $raw "renderOntologyGraph" $fnRender
  if ($null -ne $r) { $raw = $r }
}
if ($fnPanel) {
  $panel = $fnPanel
  if ($panel -notmatch "ontology-d3-root" -and $panel -notmatch "ontology-sigma-root") {
    $panel = $panel -replace "<svg id=`"ontology-graph`"[^']*'>'\+renderOntologyGraph\(map\)\+'</svg>", "<div id=`"ontology-d3-root`" class=`"w-full min-h-[420px]`"></div>"
    if ($panel -notmatch "ontology-d3-root") {
      $panel = $panel.Replace(
        "'+renderOntologyGraph(map)+'</svg>';",
        "'</svg><div id=`"ontology-d3-root`" class=`"w-full min-h-[420px]`"></div>';"
      )
    }
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

Write-Host "5) Inject mountOntologySigma..."
if ($raw -notmatch "function mountOntologySigma") {
  $a = $raw.IndexOf("function buildOntologyPanel")
  if ($a -lt 0) { $a = $raw.IndexOf("function renderOntologyGraph") }
  if ($a -lt 0) { throw "anchor missing" }
  $raw = $raw.Substring(0,$a) + $fnSigma.TrimEnd() + "`n" + $raw.Substring($a)
}

Write-Host "6) Ensure graph mount root..."
if ($raw.IndexOf("ontology-d3-root") -lt 0 -and $raw.IndexOf("ontology-sigma-root") -lt 0) {
  $raw = $raw.Replace(
    "'+renderOntologyGraph(map)+'</svg>';",
    "'</svg><div id=`"ontology-d3-root`" class=`"w-full min-h-[420px]`"></div>';"
  )
}
if ($raw.IndexOf("ontology-d3-root") -lt 0 -and $raw.IndexOf("ontology-sigma-root") -lt 0) {
  throw "graph root not injected"
}

Write-Host "7) Schedule Sigma mount after DOM inject..."
$needle = "document.getElementById('generated-content').innerHTML = contentHtml;"
if ($raw.IndexOf("scheduleOntologySigmaMount()") -lt 0) {
  if ($raw.IndexOf("scheduleOntologyD3Mount()") -ge 0) {
    $raw = $raw.Replace("scheduleOntologyD3Mount();", "scheduleOntologySigmaMount();")
  } elseif ($raw.IndexOf($needle) -ge 0) {
    $raw = $raw.Replace($needle, $needle + "`n  scheduleOntologySigmaMount();")
  } else {
    throw "inject point not found"
  }
}

Write-Host "8) Sanity..."
foreach ($k in @("graphology","sigma@","mountOntologySigma","scheduleOntologySigmaMount")) {
  if ($raw.IndexOf($k) -lt 0) { throw "missing $k" }
}
Write-Host "   OK"

Write-Host "9) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
Write-Host ("   written {0} bytes" -f (Get-Item $Out).Length)
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="feat(demo): Sigma.js network graph for Positionner (InfraNodus-style)"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
