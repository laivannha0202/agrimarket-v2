@echo off
rem QA helper: run the API e2e suite against TEST_DATABASE_URL from apps/api/.env.
rem Never hardcodes credentials here -- the suite reads TEST_DATABASE_URL via
rem test/setup-e2e.ts. Writes only to the gitignored .tmp-verify/ directory.
cd /d %~dp0
call npx vitest run --config ./vitest.config.e2e.ts --reporter=default > ..\..\.tmp-verify\e2e-full.txt 2>&1
echo EXIT=%ERRORLEVEL% >> ..\..\.tmp-verify\e2e-full.txt
