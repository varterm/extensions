# Play one MP3 and exit when it ends.
#
# System.Windows.Media.MediaPlayer only opens a file, reports its duration, and
# keeps the clip playing while its dispatcher is running. Sleeping until
# NaturalDuration is set never runs that loop, so the wait hits 8 seconds,
# the process exits, and nothing is heard. Pumping the dispatcher is the whole
# fix. afplay on macOS needs none of this; it blocks until the file ends.

param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = 'Stop'

function Pump-Player {
  $null = [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
    [Action]{},
    [System.Windows.Threading.DispatcherPriority]::ApplicationIdle
  )
}

# A redirected PowerShell error stream is UTF-16 (and sometimes CLIXML). Write
# the bytes ourselves so the editor can show the sentence as-is.
function Write-PlayerError([string]$Message) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes("$Message`n")
  $stderr = [Console]::OpenStandardError()
  $stderr.Write($bytes, 0, $bytes.Length)
  $stderr.Flush()
}

function Fail-Playback([string]$Message) {
  try { $script:player.Close() } catch {}
  Write-PlayerError $Message
  exit 1
}

try {
  Add-Type -AssemblyName PresentationCore
} catch {
  Write-PlayerError "Windows playback needs the media components that ship with Windows. $($_.Exception.Message)"
  exit 1
}

if (-not (Test-Path -LiteralPath $Path)) {
  Write-PlayerError 'Audio file not found.'
  exit 1
}

try {
  $full = (Resolve-Path -LiteralPath $Path).Path
  $script:player = New-Object System.Windows.Media.MediaPlayer
  $script:player.Volume = 1
  $script:mediaError = $null
  $script:player.add_MediaFailed({
    $detail = 'Could not open audio file.'
    if ($args.Count -ge 2 -and $args[1].ErrorException -and $args[1].ErrorException.Message) {
      $detail = [string]$args[1].ErrorException.Message
    }
    $script:mediaError = $detail
  })

  $script:player.Open([Uri]$full)
  $script:player.Play()

  $openedAt = [DateTime]::UtcNow
  while (-not $script:player.NaturalDuration.HasTimeSpan) {
    if ($script:mediaError) { Fail-Playback $script:mediaError }
    Pump-Player
    if (([DateTime]::UtcNow - $openedAt).TotalSeconds -ge 8) {
      Fail-Playback 'Could not open audio file.'
    }
    Start-Sleep -Milliseconds 30
  }

  $durationMs = $script:player.NaturalDuration.TimeSpan.TotalMilliseconds
  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(50, $durationMs) + 500)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($script:mediaError) { Fail-Playback $script:mediaError }
    Pump-Player
    $end = $script:player.NaturalDuration.TimeSpan.TotalMilliseconds
    if ($end -gt 0 -and $script:player.Position.TotalMilliseconds -ge ($end - 80)) {
      break
    }
    Start-Sleep -Milliseconds 30
  }

  try { $script:player.Stop() } catch {}
  try { $script:player.Close() } catch {}
} catch {
  try { $script:player.Close() } catch {}
  Write-PlayerError $_.Exception.Message
  exit 1
}
exit 0
