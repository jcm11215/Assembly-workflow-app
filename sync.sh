#!/data/data/com.termux/files/usr/bin/bash

git add .

git diff --cached --quiet && exit 0

git commit -m "Auto sync $(date '+%Y-%m-%d %H:%M:%S')"

git push origin main

