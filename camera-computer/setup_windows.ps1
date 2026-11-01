# SMART RECYCLE - 카메라 컴퓨터 환경 설치 (Windows PowerShell)
# 실행:  PowerShell 에서  cd camera-computer;  powershell -ExecutionPolicy Bypass -File .\setup_windows.ps1
# 옵션:  -Python "3.10"  (기본: 3.11 → 3.10 → 기본 python 순서로 찾음)
param([string]$Python = "")
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot

function Find-Python {
    if ($Python -ne "") { return @("py", "-$Python") }
    foreach ($v in @("3.11", "3.10")) {
        try { & py "-$v" -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { return @("py", "-$v") } } catch {}
    }
    try { & python -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { return @("python") } } catch {}
    return $null
}

Write-Host "[1/5] Python 확인"
$py = Find-Python
if ($null -eq $py) {
    Write-Host "Python 을 찾지 못했습니다. https://www.python.org/downloads/ 에서 Python 3.11 설치 ('Add python.exe to PATH' 체크) 후 다시 실행하세요." -ForegroundColor Red
    exit 1
}
$exe = $py[0]; $args0 = @(); if ($py.Length -gt 1) { $args0 = $py[1..($py.Length-1)] }
& $exe @args0 --version

Write-Host "[2/5] 가상환경 .venv 생성"
if (-not (Test-Path ".venv")) { & $exe @args0 -m venv .venv }
$vpy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $vpy)) { Write-Host "가상환경 생성 실패" -ForegroundColor Red; exit 1 }

Write-Host "[3/5] pip 업데이트"
& $vpy -m pip install --upgrade pip

Write-Host "[4/5] 라이브러리 설치 (torch 포함, 수 분 소요)"
# NVIDIA GPU 를 쓰려면 이 단계 전에 pytorch.org 안내대로 CUDA 버전 torch 를 먼저 설치한다.
& $vpy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Host "설치 실패 - 위 오류를 확인하세요" -ForegroundColor Red; exit 1 }

Write-Host "[5/5] 설정 파일"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host ".env 생성됨 - SERIAL_PORT / CAMERA_INDEX 를 확인하세요" }

& $vpy check_environment.py
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Green
Write-Host "  .\.venv\Scripts\Activate.ps1      (가상환경 활성화)"
Write-Host "  python test_camera.py --scan"
Write-Host "  python test_yolo.py --image <쓰레기사진.jpg>"
Write-Host "  python check_serial.py --open"
