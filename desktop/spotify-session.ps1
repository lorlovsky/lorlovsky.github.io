# Local Windows media-session adapter. Only Spotify sessions and named transport
# actions are accepted. JSON lines on stdin/stdout; no network or file access.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
$readerType = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-WinRT($Operation, [Type]$ResultType) {
    $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(4000)) { throw 'Spotify media request timed out.' }
    return $task.Result
}
$manager = Await-WinRT ($managerType::RequestAsync()) $managerType
$script:coverKey = ''
$script:cover = ''
function Get-SpotifySession {
    return $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'spotify' } | Sort-Object { if ($_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { 0 } else { 1 } } | Select-Object -First 1
}
function Get-SpotifyState($Session) {
    if (-not $Session) { return @{ available = $false; playing = $false; message = 'Open Spotify and play a song on this computer.' } }
    $media = Await-WinRT ($Session.TryGetMediaPropertiesAsync()) $propertiesType
    $info = $Session.GetPlaybackInfo()
    $timeline = $Session.GetTimelineProperties()
    $playing = $info.PlaybackStatus.ToString() -eq 'Playing'
    $duration = [Math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalSeconds)
    $position = [Math]::Max(0, ($timeline.Position - $timeline.StartTime).TotalSeconds)
    if ($playing) {
        $elapsed = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds
        if ($elapsed -ge 0 -and $elapsed -lt 86400) { $position += $elapsed }
    }
    $position = [Math]::Min($duration, $position)
    $key = "$($media.Title)|$($media.Artist)|$($media.AlbumTitle)"
    if ($key -ne $script:coverKey) {
        $script:coverKey = $key
        $script:cover = ''
        $stream = $null
        $reader = $null
        try {
            if ($media.Thumbnail) {
                $stream = Await-WinRT ($media.Thumbnail.OpenReadAsync()) $streamType
                if ($stream.Size -gt 0 -and $stream.Size -le 524288) {
                    $reader = [Windows.Storage.Streams.DataReader]::new($stream.GetInputStreamAt(0))
                    $loaded = Await-WinRT ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
                    $bytes = New-Object byte[] $loaded
                    $reader.ReadBytes($bytes)
                    $script:cover = [Convert]::ToBase64String($bytes)
                }
            }
        } catch { $script:cover = '' }
        finally {
            if ($reader) { try { $reader.Dispose() } catch {} }
            if ($stream) { try { $stream.Dispose() } catch {} }
        }
    }
    return @{
        available = $true; playing = $playing; title = [string]$media.Title; artist = [string]$media.Artist
        album = [string]$media.AlbumTitle; position = $position; duration = $duration; cover = $script:cover
        canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
        canNext = [bool]$info.Controls.IsNextEnabled; canPrevious = [bool]$info.Controls.IsPreviousEnabled
        canPlayPause = [bool]($info.Controls.IsPlayEnabled -or $info.Controls.IsPauseEnabled)
    }
}
while ($null -ne ($line = [Console]::ReadLine())) {
    $request = $null
    try {
        $request = $line | ConvertFrom-Json
        $session = Get-SpotifySession
        $action = [string]$request.action
        if ($action -notin @('status', 'toggle', 'next', 'previous', 'seek')) { throw 'Unsupported Spotify action.' }
        if ($action -ne 'status') {
            if (-not $session) { throw 'Open Spotify and play a song first.' }
            $operation = switch ($action) {
                'toggle' { $session.TryTogglePlayPauseAsync() }
                'next' { $session.TrySkipNextAsync() }
                'previous' { $session.TrySkipPreviousAsync() }
                'seek' {
                    $seconds = [double]$request.position
                    if ([double]::IsNaN($seconds) -or [double]::IsInfinity($seconds) -or $seconds -lt 0 -or $seconds -gt 604800) { throw 'Invalid seek position.' }
                    $timeline = $session.GetTimelineProperties()
                    $ticks = [long]([Math]::Min($seconds * 10000000 + $timeline.StartTime.Ticks, $timeline.EndTime.Ticks))
                    $session.TryChangePlaybackPositionAsync($ticks)
                }
            }
            if (-not (Await-WinRT $operation ([bool]))) { throw 'Spotify did not allow that playback action.' }
            Start-Sleep -Milliseconds 120
        }
        @{ id = $request.id; ok = $true; state = (Get-SpotifyState $session) } | ConvertTo-Json -Compress -Depth 5 | ForEach-Object { [Console]::WriteLine($_) }
    } catch {
        @{ id = $request.id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
    }
}
