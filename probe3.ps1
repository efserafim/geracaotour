Add-Type -AssemblyName System.Drawing
$p = (Resolve-Path '.\image\og-image.png').Path
$bmp = New-Object System.Drawing.Bitmap $p
$best=-1;$bc=$null
for ($y=505; $y -lt 540; $y++) { for ($x=231; $x -lt 565; $x++) {
  $c=$bmp.GetPixel($x,$y); $s=$c.R+$c.G+$c.B
  if ($s -gt $best) {$best=$s;$c=$c;$bc="$($c.R),$($c.G),$($c.B) @ $x,$y"} } }
"brightest=$bc"
$bmp.Dispose()
