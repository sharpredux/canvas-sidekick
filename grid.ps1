Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('C:\Users\Tristan\.gemini\antigravity\brain\31f4629a-fb04-41fa-adf7-63fd86ceb011\media__1782054058820.png')
for ($y = 100; $y -lt 400; $y += 20) {
    $line = ""
    for ($x = 700; $x -lt 1000; $x += 5) {
        $c = $img.GetPixel($x, $y)
        if ($c.R -lt 40 -and $c.G -lt 40 -and $c.B -lt 40) {
            $line += "X"
        } else {
            $line += "."
        }
    }
    Write-Host "${y}: ${line}"
}
$img.Dispose()
