# apply-exploration-fix.ps1 - never halt novelty loop
$ErrorActionPreference = "Stop"
$Owner="Geoking2104"; $Repo="KayrosLab"
$Path="kayroslab-complete-with-ai-agents.html"
$Out=Join-Path $env:TEMP $Path
$Base="https://raw.githubusercontent.com/$Owner/$Repo/main"

Write-Host "1) Download demo HTML..."
Invoke-WebRequest "$Base/$Path" -OutFile $Out -UseBasicParsing
$raw=[IO.File]::ReadAllText($Out).Replace("`r`n","`n")
Write-Host ("   {0} chars" -f $raw.Length)

Write-Host "2) Download patch fragments..."
$newParse = (Invoke-WebRequest "$Base/scripts/patches/parseExplorationResponse.js" -UseBasicParsing).Content
$newFallback = (Invoke-WebRequest "$Base/scripts/patches/buildFallbackExplorationCandidates.js" -UseBasicParsing).Content
$newCatch = (Invoke-WebRequest "$Base/scripts/patches/exploration_new_catch.js" -UseBasicParsing).Content
if ($newParse -notmatch "while\(candidates\.length<3\)") { throw "parse patch invalid" }
if ($newFallback -notmatch "buildFallbackExplorationCandidates") { throw "fallback patch invalid" }

function Replace-JsFunction([string]$src, [string]$name, [string]$body) {
  $start = $src.IndexOf("function $name")
  if ($start -lt 0) { throw "function $name not found" }
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

Write-Host "3) Replace parseExplorationResponse..."
$raw = Replace-JsFunction $raw "parseExplorationResponse" $newParse

Write-Host "4) Inject fallback builder..."
if ($raw -notmatch "function buildFallbackExplorationCandidates") {
  $a = $raw.IndexOf("function parseExplorationResponse")
  $raw = $raw.Substring(0,$a) + $newFallback.TrimEnd() + "`n" + $raw.Substring($a)
}

Write-Host "5) Soften generateIdeaRound catch..."
$marker = "border-red-400/30 bg-red-400/10 p-5 text-sm text-red-200"
$idx = $raw.IndexOf($marker)
if ($idx -lt 0) { Write-Host "   hard-fail UI already gone, skip catch replace" }
else {
  $gen = $raw.LastIndexOf("async function generateIdeaRound", $idx)
  $cs = $raw.LastIndexOf("catch(err){", $idx)
  $fi = $raw.IndexOf("}finally{", $idx)
  if ($cs -lt $gen -or $fi -lt 0) { throw "catch/finally bounds invalid" }
  $raw = $raw.Substring(0,$cs) + $newCatch.TrimEnd() + $raw.Substring($fi)
}

Write-Host "6) i18n soft keys..."
if ($raw -notmatch "exploration_soft_title:") {
  $raw = [regex]::Replace($raw, "exploration_parse_error:'La r[^']+Relancez la boucle\.", "exploration_parse_error:'Format partiel - poursuite avec pistes de clarification.',`n    exploration_soft_title:'La boucle continue',`n    exploration_soft_body:'Format incomplet: 3 pistes de clarification (beneficiaire, contrainte, succes). Repondez puis relancez.',`n    exploration_soft_fail:'Exploration: bascule clarification.'", 1)
  $raw = [regex]::Replace($raw, "exploration_parse_error:'The exploration response[^']+'", "exploration_parse_error:'Partial format - continuing with clarification paths.',`n    exploration_soft_title:'The loop continues',`n    exploration_soft_body:'Incomplete format: 3 clarification paths (beneficiary, constraint, success). Answer then relaunch.',`n    exploration_soft_fail:'Exploration: switching to clarification mode.'", 1)
}

Write-Host "7) Prompt: never refuse..."
if ($raw -notmatch "Never refuse; never return empty JSON") {
  $raw = $raw.Replace(
    "Do not reveal private reasoning or chain-of-thought; provide only concise decision evidence.",
    "Do not reveal private reasoning or chain-of-thought; provide only concise decision evidence. If the idea is vague, still return 3 sharper rephrasings and put missing inputs into criticalUnknowns. Never refuse; never return empty JSON."
  )
}

Write-Host "8) Soften auto_retry_fail copy..."
$raw = [regex]::Replace($raw, "auto_retry_fail:'Apr[^']+'", "auto_retry_fail:'Format encore imparfait - la boucle propose des pistes de clarification pour avancer.'")
$raw = $raw.Replace(
  "auto_retry_fail:'Format still invalid after several attempts. Reframe the idea or retry.'",
  "auto_retry_fail:'Format still imperfect - the loop proposes clarification paths so you can move forward.'"
)

Write-Host "9) Sanity..."
foreach ($k in @("buildFallbackExplorationCandidates","while(candidates.length<3)")) {
  if ($raw.IndexOf($k) -lt 0) { throw "missing $k" }
}
Write-Host "   OK"

Write-Host "10) Push..."
[IO.File]::WriteAllText($Out, $raw, [Text.UTF8Encoding]::new($false))
Write-Host ("   written {0} bytes" -f (Get-Item $Out).Length)
$b64=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Out))
$meta=gh api "repos/$Owner/$Repo/contents/${Path}?ref=main" | ConvertFrom-Json
@{ message="fix(demo): never halt novelty loop - clarification candidates on parse fail"; content=$b64; branch="main"; sha=$meta.sha } |
  ConvertTo-Json -Compress | gh api --method PUT "repos/$Owner/$Repo/contents/$Path" --input -

Write-Host "DONE. Ctrl+F5 https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html"
