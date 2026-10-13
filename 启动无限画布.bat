@echo off
chcp 65001 >nul
title WN 无限画布 - 本机启动
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 22.12 或更高版本，建议 24 LTS。
  pause
  exit /b 1
)
node "%~dp0一键启动.cjs" %*
if errorlevel 1 (
  echo.
  echo 启动未完成，请查看上方提示。首次使用请先进入 web 目录执行 npm ci。
  pause
  exit /b 1
)
