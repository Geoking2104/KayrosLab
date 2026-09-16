Add-Type -AssemblyName System.Drawing
$src = 'assets/logo-kayroslab.png'
$logo = [System.Drawing.Image]::FromFile((Resolve-Path $src))

function Resize($img, $w, $h, $out) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $out"
}

Resize $logo 32 32 'assets/favicon-32.png'
Resize $logo 180 180 'assets/apple-touch-icon.png'
Resize $logo 512 512 'assets/icon-512.png'

# OG image: light canvas + logo + wordmark (SLDS light)
$og = New-Object System.Drawing.Bitmap(1200, 630)
$g = [System.Drawing.Graphics]::FromImage($og)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::FromArgb(255, 243, 242, 242))
$g.DrawImage($logo, 90, 245, 140, 140)
$font = New-Object System.Drawing.Font('Segoe UI', 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 3, 45, 96))
$g.DrawString('KayrosLab', $font, $ink, 260, 288)
$sub = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('Governed AI decision console', $sub, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 112, 110, 107))), 264, 372)
$og.Save('assets/og-image.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $og.Dispose(); $logo.Dispose()
Write-Output 'wrote assets/og-image.png'
