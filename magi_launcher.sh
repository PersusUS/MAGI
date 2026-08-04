#!/bin/bash
# MAGI Tablet Autonomous Launcher Script for Termux / Android

DIR="$( cd "$( dirname "$0" )" && pwd )"
cd "$DIR"

# 1. Matar instancias previas para garantizar un arranque limpio
pkill -f "python main.py" 2>/dev/null

# 2. Iniciar el servidor backend Python en segundo plano
python main.py > magi.log 2>&1 &
SERVER_PID=$!

echo "Iniciando sistema MAGI..."
# 3. Esperar hasta que el puerto 8050 responda
while ! curl -s http://127.0.0.1:8050 >/dev/null; do
    sleep 0.5
done

# 4. Abrir en el navegador de Android (Pantalla completa PWA / Chrome)
if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "http://127.0.0.1:8050"
elif command -v am >/dev/null 2>&1; then
    am start -a android.intent.action.VIEW -d "http://127.0.0.1:8050"
fi

echo "MAGI activo (PID: $SERVER_PID). Cuando se cierre, se detendrá el servidor."

# 5. Trap para detener el proceso Python automáticamente al cerrar
trap "kill $SERVER_PID 2>/dev/null; pkill -f 'python main.py' 2>/dev/null; exit 0" INT TERM EXIT
wait $SERVER_PID
