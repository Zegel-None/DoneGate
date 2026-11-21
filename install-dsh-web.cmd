@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo [DoneGate V4] 正在为 Windows 下的 DeepSeek Harness (Web UI) 安装完结门插件...
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js 22.19+ 或 24+ 后重试。
  pause
  exit /b 3
)
node "%~dp0runner\dsh\install-dsh-web.mjs" %*
if errorlevel 1 (
  echo [失败] 安装过程中出现异常，退出码: %errorlevel%
  pause
  exit /b %errorlevel%
)
echo.
echo [完成] 请重启或刷新您的 DeepSeek Harness Web 页面 (如 http://127.0.0.1:3000)，在对话顶部点击「完结门」标签页！
if "%1"=="" pause
exit /b 0
