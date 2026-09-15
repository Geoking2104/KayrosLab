Add-Type -AssemblyName System.Drawing
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$root = (Get-Location).Path
$probe = '<script>window.addEventListener("load",function(){var d=document.documentElement;if(d.scrollWidth>d.clientWidth+1){var b=document.createElement("div");b.style.cssText="position:fixed;top:0;left:0;right:0;height:60px;background:#ff00ff;z-index:2147483000";document.body.appendChild(b);}});</script>'
# control A: overflows at 375 (2000px block)  control B: fits (100% block)
$cases = @{ 'ctrl_overflow' = '<div style="width:2000px;height:80px;background:#123456"></div>'; 'ctrl_fit' = '<div style="width:100%;height:80px;background:#123456"></div>' }
foreach ($name in $cases.Keys) {
  $tmp = Join-Path $root ".$name.html"
  $doc = "<!doctype html><html><head><meta charset=`"utf-8`"><style>body{margin:0}</style></head><body>$($cases[$name])$probe</body></html>"
  [System.IO.File]::WriteAllText($tmp, $doc, (New-Object System.Text.UTF8Encoding($false)))
  $png = Join-Path $env:TEMP "$name.png"
  & $chrome --headless=new --disable-gpu --no-first-run --user-data-dir="$env:TEMP\pc_$name" --hide-scrollbars --virtual-time-budget=2000 --window-size="375,900" --screenshot="$png" "file:///$($root.Replace('\','/'))/.$name.html" 2>$null | Out-Null
  $mag = 0; $exists = Test-Path $png
  if ($exists) { $b = New-Object System.Drawing.Bitmap($png); for ($y=2;$y -lt 120;$y+=2){ for ($x=2;$x -lt $b.Width;$x+=6){ $c=$b.GetPixel($x,$y); if ($c.R -ge 200 -and $c.G -le 70 -and $c.B -ge 200){$mag++} } }; $b.Dispose(); Remove-Item $png -Force }
  Write-Output ("{0}: png={1} magenta={2} -> {3}" -f $name,$exists,$mag,($(if($mag -gt 3){'OVERFLOW'}else{'ok'})))
  Remove-Item $tmp -Force
}
