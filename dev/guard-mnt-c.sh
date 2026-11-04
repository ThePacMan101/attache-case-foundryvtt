#!/bin/bash
# Refuses any path that resolves under /mnt/c, the owner's real Windows drive, which is read-only for
# this project. Symlinks are resolved first, even dangling ones, so a link cannot slip past the check.
# Upper case is refused too, because the drive is case-insensitive.
# Usage: dev/guard-mnt-c.sh PATH...   (exit 3 on the first refused path)
set -o errexit -o nounset -o pipefail

for path in "$@"; do
  real=$(realpath -m -- "$path")
  case "${real,,}/" in
    /mnt/c/*)
      printf '[guard] REFUSED: %s resolves to %s, under /mnt/c; nothing was written.\n' "$path" "$real" >&2
      exit 3
      ;;
  esac
done
