@echo off
chcp 65001 >nul
REM 빌드 없이 실행 (개발용): 가상환경의 Python으로 GUI 실행
cd /d "%~dp0"
call .venv\Scripts\activate.bat && python smart_recycle_ai.py
