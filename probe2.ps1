Add-Type -AssemblyName System.Drawing
$p = (Resolve-Path '.\image\og-image.png').Path
$bmp = New-Object System.Drawing.Bitmap $p
$bg = $bmp.GetPixel(150,520)
$runs = @()
$ink = $false
for ($x=200; $x -lt 1000; $x++) {
  $has = $false
  for ($y=505; $y -lt 540; $y++) {
    $c = $bmp.GetPixel($x,$y)
    if ([Math]::Abs($c.R-$bg.R)+[Math]::Abs($c.G-$bg.G)+[Math]::Abs($c.B-$bg.B) -gt 40) { $has = $true; break }
  }
  if ($has -and -not $ink) { $runs += "S$x"; $ink=$true }
  elseif (-not $has -and $ink) { $runs += "E$($x-1)"; $ink=$false }
}
($runs -join ' ')
# vertical extent of first glyph cluster
$top=9999;$bot=-1
for ($y=480; $y -lt 580; $y++) {
  for ($x=230; $x -lt 600; $x++) {
    $c=$bmp.GetPixel($x,$y)
    if ([Math]::Abs($c.R-$bg.R)+[Math]::Abs($c.G-$bg.G)+[Math]::Abs($c.B-$bg.B) -gt 40) { if($y -lt $top){$top=$y}; if($y -gt $bot){$bot=$y}; break }
  }
}
"top=$top bot=$bot"
$c = $bmp.GetPixel(240,522); "ink=$($c.R),$($c.G),$($c.B)"
$bmp.Dispose()
