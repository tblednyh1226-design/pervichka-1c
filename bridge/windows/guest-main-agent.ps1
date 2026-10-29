param([switch]$Install,[switch]$Run,[switch]$Once,[switch]$Update)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1: load DPAPI types explicitly before registration.
Add-Type -AssemblyName System.Security -ErrorAction Stop
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = 'https://dwdunpyzcfdwokoczenl.supabase.co/functions/v1/plan-bridge-guest'
$defaultFile = '\\Main\data\План Меню и Бланки\ПЛАН ПРОИЗВОДСТВА С 17.08.2026.xlsx'
$homeDir = Join-Path $env:LOCALAPPDATA 'PomogatorMAINGuest'
$cfgPath = Join-Path $homeDir 'config.json'
$logPath = Join-Path $homeDir 'agent.log'
$scriptPath = Join-Path $homeDir 'main-agent.ps1'
$startupPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\PomogatorMAINGuest.lnk'
if (-not (Test-Path $homeDir)) { New-Item -ItemType Directory -Path $homeDir -Force | Out-Null }

function Write-Log([string]$value) {
    $line = '['+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+'] '+$value
    if (Test-Path $logPath) {
        if ((Get-Item $logPath).Length -gt 2097152) { Move-Item $logPath ($logPath+'.old') -Force }
    }
    Add-Content -Path $logPath -Value $line -Encoding UTF8
    if (-not $Run) { Write-Host $line }
}
function Invoke-Bridge([string]$action,[hashtable]$payload,[string]$deviceId,[string]$token) {
    $payload.action = $action
    $headers = @{}
    if ($deviceId) { $headers['x-device-id'] = $deviceId }
    if ($token) { $headers['x-main-token'] = $token }
    return Invoke-RestMethod -Uri $api -Method Post -ContentType 'application/json; charset=utf-8' -Headers $headers -Body ($payload | ConvertTo-Json -Depth 5 -Compress) -TimeoutSec 25
}
function Get-Secret([string]$encoded) {
    $encrypted = [Convert]::FromBase64String($encoded)
    $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($plain)
}
# Read an Excel workbook that may be open for editing. Never request a write lock.
# If Excel is in the middle of saving, retry rather than sending a partial XLSX.
function Read-WorkbookSnapshot([string]$path) {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    $lastError = $null
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $source = $null
        $memory = $null
        $zipMemory = $null
        $zip = $null
        try {
            $sharing = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
            $source = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $sharing)
            $originalLength = $source.Length
            if ($originalLength -lt 4 -or $originalLength -gt 15000000) {
                throw 'Размер Excel некорректен (максимум 15 МБ)'
            }
            $memory = New-Object System.IO.MemoryStream
            $source.CopyTo($memory)
            $bytes = $memory.ToArray()
            if ($bytes.Length -ne $originalLength -or $bytes[0] -ne 80 -or $bytes[1] -ne 75) {
                throw 'Excel изменился в момент чтения'
            }
            $zipMemory = New-Object System.IO.MemoryStream -ArgumentList (,$bytes)
            $zip = New-Object System.IO.Compression.ZipArchive($zipMemory,[System.IO.Compression.ZipArchiveMode]::Read,$false)
            if (-not $zip.GetEntry('[Content_Types].xml')) {
                throw 'Excel временно недоступен в формате XLSX'
            }
            # Important: do not enumerate the byte array in PowerShell pipeline.
            return ,$bytes
        } catch {
            $lastError = $_.Exception.Message
            if ($attempt -lt 6) {
                Write-Log ('Excel занят или сохраняется; повторная попытка '+$attempt+'/6')
                Start-Sleep -Seconds 2
            }
        } finally {
            if ($zip) { $zip.Dispose() }
            if ($zipMemory) { $zipMemory.Dispose() }
            if ($memory) { $memory.Dispose() }
            if ($source) { $source.Dispose() }
        }
    }
    throw ('Не удалось прочитать Excel после повторных попыток: '+$lastError)
}
function Run-One([pscustomobject]$cfg) {
    $token = Get-Secret $cfg.token_dpapi
    $response = Invoke-Bridge 'poll' @{} $cfg.device_id $token
    if (-not $response.job_id) { if ($Once) { Write-Log 'MAIN подключён. Заданий пока нет.' }; return }
    $jobId = [string]$response.job_id
    Write-Log ('Получен запрос плана: '+$jobId)
    try {
        if (-not (Test-Path -LiteralPath $cfg.source_file -PathType Leaf)) { throw ('Не найден Excel по пути: '+$cfg.source_file) }
        $fileBytes = Read-WorkbookSnapshot ([string]$cfg.source_file)
        if ($fileBytes.Length -lt 4 -or $fileBytes.Length -gt 15000000) { throw 'Неверный размер Excel (максимум 15 МБ)' }
        $headers = @{'x-device-id'=[string]$cfg.device_id;'x-main-token'=$token;'x-job-id'=$jobId}
        $uploaded = Invoke-RestMethod -Uri ($api+'?action=upload') -Method Post -Headers $headers -ContentType 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' -Body $fileBytes -TimeoutSec 90
        if (-not $uploaded.ok) { throw ('Сервер не подтвердил приём файла: '+$uploaded.error) }
        Write-Log ('Excel передан: '+$fileBytes.Length+' байт. Исходник не изменён.')
    } catch {
        $msg = $_.Exception.Message
        Write-Log ('Ошибка загрузки: '+$msg)
        try { $null = Invoke-Bridge 'fail' @{job_id=$jobId;message=$msg} $cfg.device_id $token }
        catch { Write-Log ('Не удалось передать ошибку серверу: '+$_.Exception.Message) }
    }
}
function New-RandomHex([int]$length) {
    $bytes = New-Object byte[] $length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
function Protect-Secret([string]$secret) {
    $sealed = [System.Security.Cryptography.ProtectedData]::Protect(
        [Text.Encoding]::UTF8.GetBytes($secret),$null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($sealed)
}
# Replace the installed script and restart only this agent. Existing pairing is preserved.
function Update-Main {
    if (-not (Test-Path -LiteralPath $cfgPath -PathType Leaf)) {
        throw 'MAIN ещё не установлен. Сначала запустите INSTALL_MAIN_NO_LOGIN.cmd.'
    }
    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $cfg.device_id -or -not $cfg.token_dpapi) { throw 'Нет ранее сохранённой привязки MAIN.' }
    [void](Get-Secret $cfg.token_dpapi)
    if ((Resolve-Path -LiteralPath $PSCommandPath).Path -eq $scriptPath) {
        throw 'Запустите UPDATE_MAIN.cmd из распакованной новой папки, а не из установленной.'
    }
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop |
        Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and
            $_.CommandLine.Contains($scriptPath) -and
            $_.CommandLine -match '(?i)(?:^|\s)-Run(?:\s|$)'
        })
    if ($processes.Count -gt 1) {
        throw 'Обнаружено несколько фоновых процессов MAIN. Автоматическое обновление остановлено.'
    }
    foreach ($p in $processes) {
        Write-Host ('Останавливаю старый модуль MAIN (PID '+$p.ProcessId+')…')
        Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    }
    Start-Sleep -Milliseconds 800
    Copy-Item -LiteralPath $PSCommandPath -Destination $scriptPath -Force
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startupPath)
    $shortcut.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$scriptPath+'" -Run'
    $shortcut.WorkingDirectory = $homeDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Помогатор: чтение исходного Excel только по запросу'
    $shortcut.Save()
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden',
        '-File',('"'+$scriptPath+'"'),'-Run'
    ) -WindowStyle Hidden
    Write-Host 'Модуль MAIN обновлён и снова запущен.'
    Write-Host 'Прежний код подключения сохранён. В браузере ничего менять не нужно.'
}
function Install-Main {
    Write-Host '=== Помогатор: MAIN без логина и пароля ==='
    if (-not (Test-Path -LiteralPath $defaultFile -PathType Leaf)) {
        Write-Host ('ВНИМАНИЕ: пока не виден исходный Excel: '+$defaultFile) -ForegroundColor Yellow
    } else { Write-Host ('Файл доступен: '+$defaultFile) }
    $existing = $null
    if (Test-Path $cfgPath) {
        try { $existing = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    }
    if ($existing -and $existing.device_id -and $existing.token_dpapi -and $existing.browser_token_dpapi) {
        $browserCode = Get-Secret $existing.browser_token_dpapi
        Write-Host 'Подключение уже создано. Показываю прежний код.'
    } else {
        # Fail before registering if the built-in Windows encryption is unavailable.
        $probe = Protect-Secret 'MAIN-DPAPI-TEST'
        if ((Get-Secret $probe) -ne 'MAIN-DPAPI-TEST') { throw 'Проверка защиты ключей Windows не пройдена' }
        $token = New-RandomHex 32
        $browserCode = New-RandomHex 16
        $r = Invoke-Bridge 'register' @{main_token=$token;browser_token=$browserCode} '' ''
        if (-not $r.ok -or -not $r.device_id) { throw ('Ошибка регистрации MAIN: '+$r.error) }
        $existing = [pscustomobject]@{
            device_id = $r.device_id
            token_dpapi = Protect-Secret $token
            browser_token_dpapi = Protect-Secret $browserCode
            source_file = $defaultFile
        }
        $existing | ConvertTo-Json -Depth 5 | Set-Content $cfgPath -Encoding UTF8
        Write-Host 'MAIN зарегистрирован.'
    }
    if ((Resolve-Path -LiteralPath $PSCommandPath).Path -ne $scriptPath) {
        Copy-Item -LiteralPath $PSCommandPath -Destination $scriptPath -Force
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startupPath)
    $shortcut.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$scriptPath+'" -Run'
    $shortcut.WorkingDirectory = $homeDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Помогатор: исходный Excel с MAIN только по запросу'
    $shortcut.Save()
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',
        ('"'+$scriptPath+'"'),'-Run'
    ) -WindowStyle Hidden
    $formatted = ($browserCode -replace '(.{8})(?=.)','$1-').ToUpperInvariant()
    Write-Host ''
    Write-Host 'КОД ДЛЯ ПОМОГАТОРА:' -ForegroundColor Cyan
    Write-Host $formatted -ForegroundColor Yellow
    Write-Host ''
    try { Set-Clipboard -Value $browserCode; Write-Host 'Код также скопирован в буфер обмена.' } catch {}
    Write-Host 'В браузере откройте Производство -> iiko -> Подключить MAIN, введите код.'
    Write-Host 'Этот код является ключом доступа к файлу. Не публикуйте его.'
    Write-Host 'Программа сама будет работать при входе в Windows.'
    Write-Host ('Журнал: '+$logPath)
}
try {
    if ($Install) { Install-Main; exit 0 }
    if ($Update) { Update-Main; exit 0 }
    if (-not (Test-Path $cfgPath)) { throw 'MAIN не настроен. Запустите INSTALL_MAIN.cmd и введите код из Помогатора.' }
    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @($false, 'Local\PomogatorMAINGuestPlanWorker')
    if (-not $mutex.WaitOne(0,$false)) { if ($Once) { Write-Host 'Фоновая программа MAIN уже работает.' }; exit 0 }
    try {
        if ($Once) {
            Write-Log ('Источник: '+$cfg.source_file)
            if (Test-Path -LiteralPath $cfg.source_file -PathType Leaf) { Write-Log 'Excel доступен.' }
            else { Write-Log 'Excel недоступен. Проверьте сетевой путь.' }
            Run-One $cfg
        } else {
            Write-Log 'Фоновый модуль MAIN запущен'
            while ($true) {
                try { Run-One $cfg; Start-Sleep -Seconds 5 }
                catch { Write-Log ('Ошибка связи: '+$_.Exception.Message); Start-Sleep -Seconds 15 }
            }
        }
    } finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
} catch {
    Write-Log ('ОШИБКА: '+$_.Exception.Message)
    if (-not $Run) { exit 1 }
}
