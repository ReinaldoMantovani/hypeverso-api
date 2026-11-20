@echo off
REM Atalho: dois cliques para iniciar a IA do Hypeverso junto com o Windows (modo Docker).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar-inicio-automatico.ps1" %*
pause
