#!/usr/bin/env bash
# Kill any processes listening on common dev ports
for port in 3000 4 5 5173; do
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "Killing processes on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null
  fi
done
echo "Done"
