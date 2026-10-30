# Generates the PWA icons (512/192/180) with .NET System.Drawing.
# Design: indigo→violet gradient square with a white stopwatch.
# Re-run any time:  powershell -ExecutionPolicy Bypass -File tooling/make-icons.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$iconDir = Join-Path $root "icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

function Draw-Icon([int]$size, [string]$path) {
    $s = $size / 512.0

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # background gradient
    $c1 = [System.Drawing.Color]::FromArgb(255, 109, 134, 255)  # #6d86ff
    $c2 = [System.Drawing.Color]::FromArgb(255, 138, 99, 242)   # #8a63f2
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 35.0)
    $g.FillRectangle($brush, $rect)

    $white = [System.Drawing.Color]::White
    $whiteBrush = [System.Drawing.SolidBrush]::new($white)

    # stopwatch crown stem + cap (top)
    $stem = New-Object System.Drawing.RectangleF((248 * $s), (96 * $s), (16 * $s), (40 * $s))
    $g.FillRectangle($whiteBrush, $stem)
    $cap = New-Object System.Drawing.RectangleF((232 * $s), (66 * $s), (48 * $s), (34 * $s))
    $g.FillEllipse($whiteBrush, $cap)

    # side button (right of dial)
    $side = New-Object System.Drawing.RectangleF((354 * $s), (258 * $s), (34 * $s), (34 * $s))
    $g.FillEllipse($whiteBrush, $side)

    # dial ring
    $ringRect = New-Object System.Drawing.RectangleF((126 * $s), (146 * $s), (260 * $s), (260 * $s))
    $ringWidth = [Math]::Max(2, [int](26 * $s))
    $pen = New-Object System.Drawing.Pen($white, $ringWidth)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawEllipse($pen, $ringRect)

    # hands: center (256, 276)
    $cx = 256 * $s; $cy = 276 * $s
    $handPen = New-Object System.Drawing.Pen($white, [Math]::Max(2, [int](20 * $s)))
    $handPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $handPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($handPen, $cx, $cy, $cx, 208 * $s)          # minute hand (up)
    $g.DrawLine($handPen, $cx, $cy, 312 * $s, $cy)          # hour hand (right)
    $g.FillEllipse($whiteBrush, ($cx - 14 * $s), ($cy - 14 * $s), (28 * $s), (28 * $s)) # hub

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $pen.Dispose(); $handPen.Dispose(); $brush.Dispose(); $whiteBrush.Dispose()
    $g.Dispose(); $bmp.Dispose()
    Write-Host "wrote $path"
}

Draw-Icon 512 (Join-Path $iconDir "icon-512.png")
Draw-Icon 192 (Join-Path $iconDir "icon-192.png")
Draw-Icon 180 (Join-Path $iconDir "icon-180.png")
