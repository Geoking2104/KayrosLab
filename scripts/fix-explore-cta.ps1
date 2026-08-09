# fix-explore-cta.ps1 - SyntaxError on exploration_soft_fail breaks all onclick handlers
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out)
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Fix broken exploration_soft_fail string..."
# broken: ...clarification.'',
# fixed:  ...clarification.',
$broken = "exploration_soft_fail:'Exploration: bascule clarification.''"
$fixed  = "exploration_soft_fail:'Exploration: bascule clarification.'"
if ($raw.IndexOf($broken) -lt 0) {
  # already fixed?
  if ($raw.IndexOf($fixed) -ge 0) {
    Write-Host "   already fixed on disk"
  } else {
    throw "broken pattern not found - page may have changed"
  }
} else {
  $raw = $raw.Replace($broken, $fixed)
  Write-Host "   replaced"
}

if ($raw.Contains("clarification.''")) { throw "still broken" }

Write-Host "3) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="fix(demo): repair SyntaxError on exploration_soft_fail (Explorer les possibles CTA)"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
