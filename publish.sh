#!/bin/bash
set -e
npm run build
host=marioslab.io
host_dir=/home/badlogic/chitter.marioslab.io
current_date=$(date "+%Y-%m-%d %H:%M:%S")
commit_hash=$(git rev-parse HEAD)
echo "{\"date\": \"$current_date\", \"commit\": \"$commit_hash\"}" > html/version.json

ssh -t $host "mkdir -p $host_dir/docker/data/postgres"
rsync -avz --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "export CHITTER_DB=$CHITTER_DB && export CHITTER_DB_USER=$CHITTER_DB_USER && export CHITTER_DB_PASSWORD=$CHITTER_DB_PASSWORD && cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi