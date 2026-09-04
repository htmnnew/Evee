#!/bin/sh
PID=$(lsof -ti tcp:8000)
if [ -n "$PID" ]; then
  kill "$PID" && echo "Evee server stopped (pid $PID)."
else
  echo "No server running on port 8000."
fi
