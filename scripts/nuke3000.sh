#!/usr/bin/env bash
# Kill any processes listening on dev ports (server: 5201, client: 5173)
for port in 5201 5173; do
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Killing processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
done
echo "Done"
