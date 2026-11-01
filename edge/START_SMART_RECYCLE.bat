@echo off
chcp 65001 >nul
title SMART RECYCLE AI
REM ============================================================
REM  SMART RECYCLE - 카메라 컴퓨터 원클릭 실행
REM  최신 코드 받기(git pull) -> 라이브러리 확인 -> 프로그램 실행
REM  팀 설정은 settings.env 로 자동 적용, 토큰·COM 포트 등은 .env 에 유지됩니다.
REM  바탕화면 바로가기: 이 파일 우클릭 -> 보내기 -> 바탕 화면에 바로 가기 만들기
REM ============================================================
cd /d "%~dp0"

echo [1/4] 최신 코드 받기
where git >nul 2>nul
if %errorlevel%==0 (
  git pull --ff-only
  if errorlevel 1 echo   ! pull 실패 - 인터넷 또는 로컬 수정 확인. 현재 버전으로 계속 실행합니다.
) else (
  echo   ! git 없음 - 업데이트 없이 실행합니다.
)

if not exist .venv\Scripts\python.exe (
  echo [2/4] 가상환경 만들기 - 처음 한 번, 수 분 걸립니다
  py -3.11 -m venv .venv 2>nul || py -3.10 -m venv .venv 2>nul || python -m venv .venv
  if not exist .venv\Scripts\python.exe goto :err
  .venv\Scripts\python -m pip install --upgrade pip
) else (
  echo [2/4] 가상환경 확인
)

echo [3/4] 라이브러리 확인
.venv\Scripts\python -m pip install -q -r requirements.txt
if errorlevel 1 goto :err

if not exist .env copy /Y .env.example .env >nul
if not exist models\best_model.pt echo   ! models\best_model.pt 가 없습니다 - 프로그램 '설정'에서 모델 경로를 지정하세요.

REM 바탕화면 바로가기 (처음 한 번 자동 생성) - 이후에는 바탕화면 아이콘만 더블클릭
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $l=Join-Path $d 'SMART RECYCLE AI.lnk'; if(-not (Test-Path $l)){ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($l); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%SystemRoot%\System32\shell32.dll,22'; $s.Save(); Write-Host '  바탕화면에 SMART RECYCLE AI 바로가기를 만들었습니다' }"

echo [4/4] 실행 (이 창을 닫으면 프로그램도 종료됩니다)
.venv\Scripts\python smart_recycle_ai.py
exit /b 0

:err
echo.
echo 실패 - 위 메시지를 확인하세요. Python 3.11 설치 여부("Add python.exe to PATH")를 확인하세요.
pause
exit /b 1
