@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo [DoneGate] 正在检测 Windows 环境并安装验真完结门...
where node >nul 2>nul
if errorlevel 1 (
  echo [提示] 未检测到 Node.js，正在尝试通过 Windows 自带 winget 自动安装 Node.js LTS...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [错误] 当前电脑未安装 Node.js 且无 winget，请将 README 第一条安装提示词发给您的 AI Agent 代劳安装！
    pause
    exit /b 3
  )
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)
where git >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    echo [提示] 未检测到 Git，正在通过 winget 自动补齐 Git for Windows...
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    set "PATH=%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd;%PATH%"
  )
)
node "%~dp0skill\verify-install.mjs" --install %*
if errorlevel 1 (
  echo [失败] 完结门安装或真机验真未通过，请把上方框内信息发给您的 AI Agent 自动修复！
  if "%~1"=="" pause
  exit /b %errorlevel%
)
echo.
if "%~1"=="" pause
exit /b 0
