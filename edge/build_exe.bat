@echo off
chcp 65001 >nul
REM SMART RECYCLE AI - Windows 실행 파일 빌드 (카메라 노트북에서 1회 실행)
REM 결과: dist\SMART_RECYCLE_AI\SMART_RECYCLE_AI.exe  (폴더째 사용. .env 와 models\ 를 같은 폴더에 둔다)
setlocal
cd /d "%~dp0"
if not exist .venv (
  echo [1/4] 가상환경 생성
  py -3.11 -m venv .venv 2>nul || py -3.10 -m venv .venv 2>nul || python -m venv .venv
)
call .venv\Scripts\activate.bat || goto :err
echo [2/4] 패키지 설치
python -m pip install --upgrade pip || goto :err
pip install -r requirements.txt pyinstaller || goto :err
echo [3/4] 빌드 (수 분 소요)
pyinstaller --noconfirm --clean --windowed --name SMART_RECYCLE_AI ^
  --collect-all ultralytics --collect-all torchvision --collect-all open_clip --hidden-import start_camera_system ^
  smart_recycle_ai.py || goto :err
echo [4/4] 설정·모델 복사
if exist .env (copy /Y .env dist\SMART_RECYCLE_AI\.env >nul) else (copy /Y .env.example dist\SMART_RECYCLE_AI\.env >nul)
copy /Y settings.env dist\SMART_RECYCLE_AI\settings.env >nul
if not exist dist\SMART_RECYCLE_AI\models mkdir dist\SMART_RECYCLE_AI\models
if exist models\best_model.pt copy /Y models\best_model.pt dist\SMART_RECYCLE_AI\models\ >nul
echo.
echo 완료: dist\SMART_RECYCLE_AI\SMART_RECYCLE_AI.exe
echo  - dist\SMART_RECYCLE_AI\.env 의 BACKEND_URL / AI_API_TOKEN / HW_SERIAL_PORT 확인
echo  - dist\SMART_RECYCLE_AI\models\best_model.pt 확인
exit /b 0
:err
echo 빌드 실패 - 위 오류 메시지를 확인하세요.
exit /b 1
