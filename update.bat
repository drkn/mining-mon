@echo off
setlocal
cd /D %~dp0
git reset --hard
git pull
npm i