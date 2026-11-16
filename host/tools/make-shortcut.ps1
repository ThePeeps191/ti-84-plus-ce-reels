# Creates a "TI-84 Reels" shortcut on the desktop that runs the laptop app (npm start) in a console window.
# usage: powershell -ExecutionPolicy Bypass -File host\tools\make-shortcut.ps1
$hostDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'TI-84 Reels.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:ComSpec"
$lnk.Arguments = "/k title TI-84 Reels && npm start"
$lnk.WorkingDirectory = "$hostDir"
$lnk.Description = 'Stream Instagram Reels to the TI-84 Plus CE'
$lnk.Save()
Write-Output "Created $lnkPath"
