@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem Use Python from PATH when available, otherwise fall back to the DSH bundled Python.
python -V >nul 2>nul
if errorlevel 1 (
  set "PY=C:\Users\chen5\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
) else (
  set "PY=python"
)

echo ============================================
echo  Cuotiben Android APK build (aapt2 + d8, no Gradle)
echo ============================================
"%PY%" "%~dp0build_apk.py"
if errorlevel 1 (
  echo.
  echo [FAILED] Please check the errors above.
  exit /b 1
)
echo.
echo [OK] APK written to this directory.
endlocal
