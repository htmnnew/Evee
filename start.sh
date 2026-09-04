#!/bin/sh
cd "$(dirname "$0")"
echo "Evee running at http://localhost:8000/Evee.html"
open "http://localhost:8000/Evee.html"
python3 serve.py 8000
