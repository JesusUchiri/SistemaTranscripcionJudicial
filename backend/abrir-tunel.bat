@echo off
echo.
echo Abriendo tunel SSH al servidor (Postgres y Redis).
echo Cuando pida la contrasena, introducela y DEJA ESTA VENTANA ABIERTA.
echo.
ssh -L 5432:judiscribe-base-de-datos-y6sd64:5432 -L 6379:judiscribe-base-de-datos-qigub7:6379 root@72.60.114.137
pause
