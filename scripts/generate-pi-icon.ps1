$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$assetDir = Join-Path $root 'desktop/assets'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [int]$Size,
    [int]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $max = $Size - 1
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($max - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($max - $diameter, $max - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $max - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-PiPng {
  param(
    [int]$Size,
    [string]$Path
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $radius = [Math]::Max(3, [int]($Size * 0.22))
    $rectPath = New-RoundedRectPath -Size $Size -Radius $radius
    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 5, 5, 5))
    $graphics.FillPath($bgBrush, $rectPath)

    $fontSize = [Math]::Max(8, [single]($Size * 0.468))
    $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
    $graphics.DrawString('Pi', $font, $textBrush, $rect, $format)
  } finally {
    if ($format) { $format.Dispose() }
    if ($textBrush) { $textBrush.Dispose() }
    if ($font) { $font.Dispose() }
    if ($bgBrush) { $bgBrush.Dispose() }
    if ($rectPath) { $rectPath.Dispose() }
    $graphics.Dispose()
  }

  try {
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $bitmap.Dispose()
  }
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngFiles = @()
foreach ($size in $sizes) {
  $pngPath = Join-Path $assetDir "pi-icon-$size.png"
  New-PiPng -Size $size -Path $pngPath
  $pngFiles += [PSCustomObject]@{
    Size = $size
    Path = $pngPath
    Bytes = [System.IO.File]::ReadAllBytes($pngPath)
  }
}

$icoPath = Join-Path $assetDir 'pi-icon.ico'
$stream = New-Object System.IO.FileStream $icoPath, ([System.IO.FileMode]::Create), ([System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter $stream
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$pngFiles.Count)

  $offset = 6 + (16 * $pngFiles.Count)
  foreach ($item in $pngFiles) {
    $writer.Write([byte]($(if ($item.Size -eq 256) { 0 } else { $item.Size })))
    $writer.Write([byte]($(if ($item.Size -eq 256) { 0 } else { $item.Size })))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$item.Bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $item.Bytes.Length
  }

  foreach ($item in $pngFiles) {
    $writer.Write($item.Bytes)
  }
} finally {
  $writer.Dispose()
  $stream.Dispose()
}

Write-Host "Generated $icoPath"
