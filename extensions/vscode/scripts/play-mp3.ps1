param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

Add-Type -AssemblyName PresentationCore
$full = (Resolve-Path -LiteralPath $Path).Path
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = 1
$player.Open([Uri]$full)
$player.Play()

$waited = 0
while (-not $player.NaturalDuration.HasTimeSpan) {
  Start-Sleep -Milliseconds 40
  $waited += 40
  if ($waited -ge 8000) {
    $player.Close()
    throw "Could not open audio file."
  }
}

$ms = [Math]::Max(50, [int]$player.NaturalDuration.TimeSpan.TotalMilliseconds)
Start-Sleep -Milliseconds $ms
$player.Stop()
$player.Close()
