#!/bin/bash
set -euo pipefail
unset NODE_OPTIONS NODE_PATH
exec /usr/local/bin/node /opt/starter/job-started.ts
