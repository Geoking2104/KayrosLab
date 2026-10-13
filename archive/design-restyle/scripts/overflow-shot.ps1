param([int[]]$Widths = @(375, 834, 1440))
Add-Type -AssemblyName System.Drawing
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$root = (Get-Location).Path
$probe = '<script>window.addEventListener("load",function(){var d=document.documentElement;if(d.scrollWidth>d.clientWidth+1){var b=document.createElement("div");b.style.cssText="position:fixed;top:0;left:0;right:0;height:60px;background:#ff00ff;z-index:2147483000";document.body.appendChild(b);}});</script>'
$pages = Get-ChildItem -File *.html | Select-Object -ExpandProperty Name
$results = @()
foreach ($page in $pages) {
  $html = [System.IO.File]::ReadAllText((Join-Path $root $page))
  $tmp = Join-Path $root (".ovt_" + $page)
  [System.IO.File]::WriteAllText($tmp, ($html -replace '</body>', ($probe + '</body>')), (New-Object System.Text.UTF8Encoding($false)))
  $tmpName = [System.IO.Path]::GetFileName($tmp)
  foreach ($w in $Widths) {
    $rendered = $false; $magenta = 0
    for ($try = 1; $try -le 3 -and -not $rendered; $try++) {
      $png = Join-Path $env:TEMP ("ov_{0}_{1}_{2}.png" -f ($page -replace '\.html$',''), $w, $try)
      $prof = Join-Path $env:TEMP ("ovp_{0}_{1}_{2}" -f ($page -replace '\.html$',''), $w, $try)
      & $chrome --headless=new --disable-gpu --no-first-run --user-data-dir="$prof" --hide-scrollbars --window-size="$w,900" --screenshot="$png" "file:///$($root.Replace('\','/'))/$tmpName" 2>$null | Out-Null
      Remove-Item -Recurse -Force $prof -ErrorAction SilentlyContinue
      if (Test-Path $png) {
        $rendered = $true
        $b = New-Object System.Drawing.Bitmap($png)
        for ($y = 2; $y -lt [Math]::Min(120, $b.Height); $y += 4) { for ($x = 2; $x -lt $b.Width; $x += 12) { $c = $b.GetPixel($x, $y); if ($c.R -ge 200 -and $c.G -le 70 -and $c.B -ge 200) { $magenta++ } } }
        $b.Dispose(); Remove-Item $png -Force
      } else { Start-Sleep -Milliseconds 700 }
    }
    $status = if (-not $rendered) { 'NO-RENDER' } elseif ($magenta -gt 1) { 'OVERFLOW' } else { 'ok' }
    $results += [pscustomobject]@{ page = $page; width = $w; status = $status; magenta = $magenta }
  }
  Remove-Item $tmp -Force
}
$results | ConvertTo-Json | Set-Content -Path (Join-Path $root 'DELIVERY\overflow-report.json') -Encoding UTF8
$bad = ($results | Where-Object { $_.status -eq 'OVERFLOW' } | Measure-Object).Count
$nor = ($results | Where-Object { $_.status -eq 'NO-RENDER' } | Measure-Object).Count
$results | Where-Object { $_.status -ne 'ok' } | ForEach-Object { "{0} {1} @{2}px (magenta={3})" -f $_.status,$_.page,$_.width,$_.magenta }
Write-Output ("overflow rows: {0} ; no-render rows: {1} ; ok rows: {2} ; total {3}" -f $bad, $nor, ($results | Where-Object { $_.status -eq 'ok' } | Measure-Object).Count, $results.Count)
