@echo off
setlocal
title Luma Studio
cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    py -3 -B "%~dp0windows\launch.py" %*
    goto finished
  )
)

where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
  if not errorlevel 1 (
    python -B "%~dp0windows\launch.py" %*
    goto finished
  )
)

echo.
echo Python 3.10 or newer was not found.
echo Install Python from https://www.python.org/downloads/windows/
echo Select "Add python.exe to PATH" during installation.
echo Then double-click START-WINDOWS.cmd again.
echo No API key or program file has been changed.
pause
exit /b 1

:finished
if errorlevel 1 (
  echo.
  echo Luma Studio could not start. Read the message above.
  pause
  exit /b 1
)
exit /b 0
