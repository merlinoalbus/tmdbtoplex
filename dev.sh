#!/usr/bin/env bash

FE_DIR="./frontend"
BE_DIR="./imdb-scraper-backend"

FE_PID_FILE=".fe_pid"
BE_PID_FILE=".be_pid"

start() {
    echo "==> Avvio Backend IMDb Scraper..."
    cd "$BE_DIR" || exit 1
    nohup node server.js > ../backend.log 2>&1 &
    BE_PID=$!
    echo $BE_PID > "../$BE_PID_FILE"
    echo "Backend avviato con PID $BE_PID"
    cd - >/dev/null

    echo "==> Avvio Frontend Vite..."
    cd "$FE_DIR" || exit 1
    nohup npm run dev > ../frontend.log 2>&1 &
    FE_PID=$!
    echo $FE_PID > "../$FE_PID_FILE"
    echo "Frontend avviato con PID $FE_PID"
    cd - >/dev/null

    echo ""
    echo "==> Tutti i servizi sono avviati."
    echo "Frontend: http://localhost:5173"
    echo "Backend:  http://localhost:4000"
}

stop() {
    echo "==> Arresto servizi..."

    if [ -f "$BE_PID_FILE" ]; then
        BE_PID=$(cat $BE_PID_FILE)
        if kill -0 "$BE_PID" 2>/dev/null; then
            echo "Arresto Backend (PID $BE_PID)..."
            kill "$BE_PID"
        else
            echo "Backend non in esecuzione."
        fi
        rm -f "$BE_PID_FILE"
    fi

    if [ -f "$FE_PID_FILE" ]; then
        FE_PID=$(cat $FE_PID_FILE)
        if kill -0 "$FE_PID" 2>/dev/null; then
            echo "Arresto Frontend (PID $FE_PID)..."
            kill "$FE_PID"
        else
            echo "Frontend non in esecuzione."
        fi
        rm -f "$FE_PID_FILE"
    fi

    echo "==> Tutti i servizi sono stati fermati."
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    *)
        echo "Uso: ./dev.sh {start|stop|restart}"
        ;;
esac
