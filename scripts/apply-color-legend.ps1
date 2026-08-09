# apply-color-legend.ps1 - use IWR from repo raw URL after push of full file
# Placeholder: full self-contained script is in artifacts; pushing compact GH-download version
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out).Replace("`r`n","`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download panel + sigma with color legends..."
$fnPanel = (Invoke-WebRequest "$Base/scripts/patches/buildOntologyPanel.js" -UseBasicParsing).Content
$fnSigma = (Invoke-WebRequest "$Base/scripts/patches/mountOntologySigma.js" -UseBasicParsing).Content
if ($fnPanel -notmatch "Color legend" -and $fnPanel -notmatch "Legende des couleurs") {
  throw "Panel color legend not yet on GitHub. Wait a few seconds or re-run after panel push."
}

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
      if ($depth -eq 0) { return $src.Substring(0,$start) + $body.TrimEnd() + $src.Substring($j+1) }
    }
  }
  throw "end of $name not found"
}

Write-Host "3) Replace buildOntologyPanel..."
$r = Replace-JsFunction $raw "buildOntologyPanel" $fnPanel
if ($null -eq $r) { throw "buildOntologyPanel not found - run apply-positioner-sigma.ps1 first" }
$raw = $r

Write-Host "4) Update Sigma mount..."
if ($raw.IndexOf("function mountOntologySigma") -ge 0) {
  $start = $raw.IndexOf("function mountOntologySigma")
  $endMarker = "function scheduleOntologyD3Mount(){ scheduleOntologySigmaMount(); }"
  $end = $raw.IndexOf($endMarker, $start)
  if ($end -ge 0) {
    $raw = $raw.Substring(0,$start) + $fnSigma.TrimEnd() + "`n" + $raw.Substring($end + $endMarker.Length)
  }
}

Write-Host "5) Sanity..."
if ($raw.IndexOf("Color legend") -lt 0 -and $raw.IndexOf("Legende des couleurs") -lt 0) { throw "legend missing" }
Write-Host "   OK"

Write-Host "6) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="feat(demo): color legends for Positionner entity types and edges"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -
Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
