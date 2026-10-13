Add-Type -AssemblyName System.Drawing

function New-MarkPng([int]$size, [string]$out, [bool]$withName) {
  $w = if ($withName) { [int]($size * 2.6) } else { $size }
  $h = $size
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 243, 242, 242))
  $r = [int]($size * 0.19)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $pad = [int]($size * 0.06)
  $d = $r * 2
  $rect = New-Object System.Drawing.Rectangle($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
  $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
  $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
  $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 1, 118, 211))
  $g.FillPath($brush, $path)
  $font = New-Object System.Drawing.Font('Segoe UI', [float]($size * 0.6), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString('K', $font, $ink, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $fmt)
  if ($withName) {
    $mf = New-Object System.Drawing.Font('Segoe UI', [float]($size * 0.42), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $mf.Fmt = $fmt
    $g.DrawString('KayrosLab', $mf, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 3, 45, 96))), (New-Object System.Drawing.RectangleF($size, 0, ($w - $size), $h)), $fmt)
  }
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $out"
}

New-MarkPng 32 'assets/favicon-32.png' $false
New-MarkPng 180 'assets/apple-touch-icon.png' $false
New-MarkPng 512 'assets/icon-512.png' $false
New-MarkPng 200 'assets/og-image.png' $true

