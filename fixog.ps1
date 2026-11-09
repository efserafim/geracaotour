param([int]$em = 30, [int]$ty = 505, [int]$tx = 231, [string]$text = "5 de dezembro de 2026")
Add-Type -AssemblyName System.Drawing
$src = (Resolve-Path '.\image\og-image.png').Path
$bak = (Resolve-Path '.\image').Path + "\og-image-backup.png"
if (-not (Test-Path $bak)) { Copy-Item $src $bak }
$bmp = New-Object System.Drawing.Bitmap $bak
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$bgc = [System.Drawing.Color]::FromArgb(7,18,56)
$bb = New-Object System.Drawing.SolidBrush $bgc
$g.FillRectangle($bb, 220, 498, 360, 50)
$font = New-Object System.Drawing.Font("Segoe UI", $em, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$tb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,255,255))
$g.DrawString($text, $font, $tb, $tx, $ty)
$g.Dispose()
$bmp.Save($src, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
# measure result
$b2 = New-Object System.Drawing.Bitmap $src
$top=9999;$bot=-1;$l=9999;$r=-1
for ($y=490; $y -lt 560; $y++) { for ($x=200; $x -lt 600; $x++) {
  $c=$b2.GetPixel($x,$y); if ([Math]::Abs($c.R-7)+[Math]::Abs($c.G-18)+[Math]::Abs($c.B-56) -gt 60) { if($y -lt $top){$top=$y}; if($y -gt $bot){$bot=$y}; if($x -lt $l){$l=$x}; if($x -gt $r){$r=$x} } } }
"em=$em top=$top bot=$bot left=$l right=$r width=$($r-$l) height=$($bot-$top)"
$b2.Dispose()
