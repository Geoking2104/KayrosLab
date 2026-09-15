param(
  [string]$Root = 'C:\Users\geoff\.openclaw-autoclaw\workspace\KayrosLab',
  [string]$Label = 'after',
  [int]$Width = 1440,
  [int]$Height = 1024
)
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$out = Join-Path $Root "DELIVERY\screenshots\$Label"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$pages = Get-ChildItem -File (Join-Path $Root '*.html') | Select-Object -ExpandProperty Name
foreach ($p in $pages) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($p)
  $png = Join-Path $out "$name-$Width.png"
  $url = "file:///$($Root.Replace('\','/'))/$p"
  $profile = Join-Path $env:TEMP "chrome-shoot-$Label-$name-$Width"
  & $chrome --headless=new --disable-gpu --no-first-run --no-default-browser-check --user-data-dir="$profile" --hide-scrollbars --force-device-scale-factor=1 --window-size="$Width,$Height" --screenshot="$png" $url 2>$null | Out-Null
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
  if (Test-Path $png) { Write-Output "ok $name" } else { Write-Output "FAIL $name" }
}
