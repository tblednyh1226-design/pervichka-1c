param([switch]$Install,[switch]$Run,[switch]$Once)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$api = 'https://dwdunpyzcfdwokoczenl.supabase.co/functions/v1/plan-bridge'
$defaultFile = '\\Main\data\План Меню и Бланки\ПЛАН ПРОИЗВОДСТВА С 17.08.2026.xlsx'
$homeDir = Join-Path $env:LOCALAPPDATA 'PomogatorMAIN'
$cfgPath = Join-Path $homeDir 'config.json'
$logPath = Join-Path $homeDir 'agent.log'
$scriptPath = Join-Path $homeDir 'main-agent.ps1'
$startupPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\PomogatorMAIN.lnk'
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
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($plain)
}
function Run-One([pscustomobject]$cfg) {
    $token = Get-Secret $cfg.token_dpapi
    $response = Invoke-Bridge 'poll' @{} $cfg.device_id $token
    if (-not $response.job_id) { if ($Once) { Write-Log 'MAIN подключён. Заданий пока нет.' }; return }
    $jobId = [string]$response.job_id
    Write-Log ('Получен запрос плана: '+$jobId)
    try {
        if (-not (Test-Path -LiteralPath $cfg.source_file -PathType Leaf)) { throw ('Не найден Excel по пути: '+$cfg.source_file) }
        $fileBytes = [IO.File]::ReadAllBytes([string]$cfg.source_file)
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
function Install-Main {
    Write-Host '=== Подключение MAIN к Помогатору ==='
    if (-not (Test-Path -LiteralPath $defaultFile -PathType Leaf)) {
        Write-Host ('ВНИМАНИЕ: файл пока недоступен: '+$defaultFile) -ForegroundColor Yellow
    } else { Write-Host ('Excel найден: '+$defaultFile) }
    $existing = $null
    if (Test-Path $cfgPath) { try { $existing = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {} }
    if ($existing -and $existing.device_id -and $existing.token_dpapi) {
        Write-Host 'MAIN уже привязан. Сохраняю существующую привязку.'
    } else {
        $code = (Read-Host 'Введите код из Помогатора (12 символов)').Trim().Replace('-','')
        if ($code -notmatch '^[0-9a-fA-F]{12}$') { throw 'Неверный формат кода (должно быть 12 символов)' }
        $bytes = New-Object byte[] 32
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $token = ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
        $r = Invoke-Bridge 'pair' @{code=$code;token=$token} '' ''
        if (-not $r.ok -or -not $r.device_id) { throw ('Не удалось подключить MAIN: '+$r.error) }
        $secretBytes = [Text.Encoding]::UTF8.GetBytes($token)
        $sealed = [Security.Cryptography.ProtectedData]::Protect($secretBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $existing = [pscustomobject]@{device_id=$r.device_id;token_dpapi=[Convert]::ToBase64String($sealed);source_file=$defaultFile}
        $existing | ConvertTo-Json -Depth 5 | Set-Content $cfgPath -Encoding UTF8
        Write-Host 'MAIN успешно привязан к Помогатору.'
    }
    if ((Resolve-Path -LiteralPath $PSCommandPath).Path -ne $scriptPath) { Copy-Item -LiteralPath $PSCommandPath -Destination $scriptPath -Force }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startupPath)
    $shortcut.TargetPath = (Join-Path $PSHOME 'powershell.exe')
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$scriptPath+'" -Run'
    $shortcut.WorkingDirectory = $homeDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Помогатор: передача плана производства с MAIN по запросу'
    $shortcut.Save()
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+$scriptPath+'"'),'-Run') -WindowStyle Hidden
    Write-Host 'Автозапуск установлен. MAIN ожидает кнопки в Помогаторе.'
    Write-Host ('Журнал: '+$logPath)
}
try {
    if ($Install) { Install-Main; exit 0 }
    if (-not (Test-Path $cfgPath)) { throw 'MAIN не настроен. Запустите INSTALL_MAIN.cmd и введите код из Помогатора.' }
    $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @($false, 'Local\PomogatorMAINPlanWorker')
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
