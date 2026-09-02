# Source this: `. scripts/env.sh`
#
# Puts the project's Python and Node on PATH. Both live outside the repo because
# home here has an inode quota; override the location with ALPHA_AUDIT_ENV_ROOT.
#
#   .venv/bin  first  -> `python`, `pytest`, `uvicorn` are the project's
#   env/bin    second -> `node`, `npm` (the venv layer has no node)
: "${ALPHA_AUDIT_ENV_ROOT:=/scratch/$USER/alpha-audit}"

if [ ! -x "$ALPHA_AUDIT_ENV_ROOT/.venv/bin/python" ]; then
  echo "no environment at $ALPHA_AUDIT_ENV_ROOT -- see the README's Environment section" >&2
else
  export ALPHA_AUDIT_ENV_ROOT
  export PATH="$ALPHA_AUDIT_ENV_ROOT/.venv/bin:$ALPHA_AUDIT_ENV_ROOT/env/bin:$PATH"
fi
