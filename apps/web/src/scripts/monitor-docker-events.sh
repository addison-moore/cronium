#!/bin/bash

echo "🔍 Monitoring Docker events for cronium containers..."
echo ""

# Monitor docker events in real-time
docker events --filter "label=cronium.type=sidecar" --format "{{.Time}} {{.Type}} {{.Action}} {{.Actor.Attributes.name}} {{.Actor.Attributes.exitCode}}" &
EVENTS_PID=$!

# Also monitor container creation/deletion
watch_containers() {
  while true; do
    containers=$(docker ps -a --filter "label=cronium.type=sidecar" --format "{{.Names}}|{{.Status}}" 2>/dev/null)
    if [ -n "$containers" ]; then
      echo -e "\n📦 Sidecar containers detected:"
      echo "$containers" | while IFS='|' read -r name status; do
        echo "   $name: $status"
        
        # If container just started or stopped, get logs
        if [[ "$status" == *"Exited"* ]] || [[ "$status" == *"second"* ]]; then
          echo "   Logs:"
          docker logs "$name" 2>&1 | head -10 | sed 's/^/      /'
        fi
      done
    fi
    sleep 2
  done
}

watch_containers &
WATCH_PID=$!

echo "Press Ctrl+C to stop monitoring"
echo ""

# Cleanup on exit
trap "kill $EVENTS_PID $WATCH_PID 2>/dev/null" EXIT

# Keep script running
wait