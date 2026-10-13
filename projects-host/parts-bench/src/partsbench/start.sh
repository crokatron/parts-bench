#!/usr/bin/env bash
# Parts Bench. Point LIBRARY at wherever the parts should live.
cd "$(dirname "$0")"
LIBRARY="${LIBRARY:-$PWD/library}"
exec python3 app.py --root "$LIBRARY" --port 8770
