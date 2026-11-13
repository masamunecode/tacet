#!/bin/zsh
# ./shot.sh [WxH] [query] [seconds]  e.g. ./shot.sh 1440x900 "room=2&hour=18.5" 5
cd "$(dirname "$0")" && node shot.mjs "$@"
