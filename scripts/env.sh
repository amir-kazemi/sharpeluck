# Source this: `. scripts/env.sh`
#
# Puts the project's Python and Node on PATH. Both live outside the repo because
# home here has an inode quota; override the location with SHARPELUCK_ENV_ROOT.
#
#   .venv/bin  first  -> `python`, `pytest`, `uvicorn` are the project's
#   env/bin    second -> `node`, `npm` (the venv layer has no node)
: "${SHARPELUCK_ENV_ROOT:=/scratch/$USER/sharpeluck}"

if [ ! -x "$SHARPELUCK_ENV_ROOT/.venv/bin/python" ]; then
  echo "no environment at $SHARPELUCK_ENV_ROOT -- see the README's Environment section" >&2
else
  export SHARPELUCK_ENV_ROOT
  export PATH="$SHARPELUCK_ENV_ROOT/.venv/bin:$SHARPELUCK_ENV_ROOT/env/bin:$PATH"
fi
