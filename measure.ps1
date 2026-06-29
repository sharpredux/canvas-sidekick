Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('C:\Users\Tristan\.gemini\antigravity\brain\31f4629a-fb04-41fa-adf7-63fd86ceb011\media__1782054058820.png')
$width = $img.Width
$height = $img.Height

$minX = $width
$maxX = 0
$minY = $height
$maxY = 0

for ($x = 500; $x -lt $width - 10; $x += 2) {
    for ($y = 50; $y -lt $height - 50; $y += 2) {
        $color = $img.GetPixel($x, $y)
        if ($color.R -lt 40 -and $color.G -lt 40 -and $color.B -lt 40) {
            # noise check
            $c2 = $img.GetPixel($x+5, $y)
            $c3 = $img.GetPixel($x, $y+5)
            if ($c2.R -lt 40 -and $c3.R -lt 40) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
}
$img.Dispose()
Write-Host "Widget BBox: Min($minX, $minY) Max($maxX, $maxY)"
Write-Host "Widget Size: $($maxX - $minX) x $($maxY - $minY)"
