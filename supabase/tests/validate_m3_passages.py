"""Compatibility entry point for the staging-only, rollback-protected validator.
The target is explicitly configured and checked in validate_m3_staging.py; no .env from
this repository is read and no container runtime is used.
"""
from validate_m3_staging import main

if __name__ == "__main__":
    raise SystemExit(main())
