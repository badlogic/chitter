#!/bin/sh

# Function to handle SIGINT and SIGTERM
handleSignal() {
    echo "Signal received, stopping..."
    exit 0
}

# Trap SIGINT and SIGTERM
trap 'handleSignal' INT TERM

if [ "$POSTGRES_DB" = "mem" ]; then
    echo "POSTGRES_DB is set to 'mem', not starting PostgreSQL."
    # Keep the container running and wait for signal
    while true; do sleep 1; done
else
    # Call the original entrypoint script of the PostgreSQL image
    docker-entrypoint.sh postgres
fi
