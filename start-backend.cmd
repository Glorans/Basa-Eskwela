@echo off
cd /d "%~dp0server"
set "DOTENV_PATH=%LOCALAPPDATA%\ReadFlow\basa-eskwela-server.env"
npm start
