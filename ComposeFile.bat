@echo off

echo 1. Compose up development enviorment
echo 2. Compose up production enviorment
echo 3. Compose down production enviorment
echo 4. Compose down development enviorment
echo 5. See which images are running and their size
echo

choice /C 12345 /M "Choose the command you would like to run: "

if errorlevel 5 GOTO DockPS
if errorlevel 4 GOTO DevDown
if errorlevel 3 GOTO ProdDown
if errorlevel 2 GOTO ProdUp
if errorlevel 1 GOTO DevUp

:DevUp
echo Compose Dev Up
docker compose up
GOTO end

:ProdUp
echo Compose ProdUp
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml up
GOTO end

:ProdDown
echo Compose ProdDown
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml down
GOTO end

:DevDown
echo Compose DevDown
docker compose down
GOTO end

:DockPS
echo docker ps
docker ps
pause
GOTO end

:end