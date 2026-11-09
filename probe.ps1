Add-Type -AssemblyName System.Drawing
$p = (Resolve-Path '.\image\og-image.png').Path
$bmp = New-Object System.Drawing.Bitmap $p
"size=$($bmp.Width)x$($bmp.Height)"
$bg = $bmp.GetPixel(150,520)
"bg=$($bg.R),$($bg.G),$($bg.B)"
for ($y=480; $y -lt 570; $y+=5) {
  $min=9999; $max=-1
  for ($x=150; $x -lt 1050; $x++) {
    $c = $bmp.GetPixel($x,$y)
    $d = [Math]::Abs($c.R-$bg.R)+[Math]::Abs($c.G-$bg.G)+[Math]::Abs($c.B-$bg.B)
    if ($d -gt 40) { if ($x -lt $min) {$min=$x}; if ($x -gt $max) {$max=$x} }
  }
  "y=$y min=$min max=$max"
}
$bmp.Dispose()
