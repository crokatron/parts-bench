@echo off
REM Parts Bench - double-click to run.
REM Set your library folder here. Use a UNC path or a mapped drive for the NAS.
set LIBRARY=%~dp0library

REM Uncomment and edit one of these instead to put the library on the NAS:
REM set LIBRARY=\\NAS\prints\PartsBench
REM set LIBRARY=Z:\PartsBench

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0app.py" --root "%LIBRARY%" --port 8770
) else (
  python "%~dp0app.py" --root "%LIBRARY%" --port 8770
)
pause
