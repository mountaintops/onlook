#!/usr/bin/env bash

# This script kills any process using ports 3000 and 8080-8099.
# It uses 'lsof' to find the PIDs and 'kill -9' to terminate them.

# Define the targets
TARGET_PORTS=(3000)
for i in {8080..8099}; do
  TARGET_PORTS+=($i)
done

echo "🔎 Checking for processes on ports 3000 and 8080-8099..."

KILLED_COUNT=0

for port in "${TARGET_PORTS[@]}"; do
  # Get PIDs using the port
  PIDS=$(lsof -ti :"$port" 2>/dev/null)
  
  if [ -n "$PIDS" ]; then
    # Flatten PIDs list for display and killing
    PID_LIST=$(echo "$PIDS" | xargs)
    echo "🚫 Port $port is used by PID(s): $PID_LIST. Killing..."
    
    # Kill the processes
    echo "$PIDS" | xargs kill -9 2>/dev/null
    ((KILLED_COUNT++))
  fi
done

if [ "$KILLED_COUNT" -gt 0 ]; then
  echo "✅ Finished. Killed processes on $KILLED_COUNT different port(s)."
else
  echo "✨ No processes found on the specified ports."
fi
