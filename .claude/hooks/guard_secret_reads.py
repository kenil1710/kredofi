#!/usr/bin/env python3
"""PreToolUse guard for Bash (SECURITY_AUDIT.md, Nov 11 entry): secret files are never searched or printed.

Blocks a shell command when one of its segments
  - runs a search/print tool (grep, egrep, fgrep, rg, ag, ack, find, cat, head, tail, less, more, sed, awk,
    strings, xxd, od, bat, diff) and names .env, .env.local, any other .env.* (except .env.example) or
    .near-credentials;
  - runs grep -r/-R (reads every file, .env included): use `git grep`, which sees tracked files only;
  - runs rg with -u/--hidden/--no-ignore (rg otherwise skips .env, which is hidden and git-ignored).
`source .env` / `set -a; source .env` and the project scripts that load keys without printing them stay allowed.
Exit 2 blocks the call and tells Claude why.
"""
import json, re, shlex, sys

TOOLS = {"grep", "egrep", "fgrep", "rg", "ag", "ack", "find", "cat", "head", "tail", "less", "more",
         "sed", "awk", "gawk", "strings", "xxd", "od", "bat", "diff"}
SECRET = re.compile(r"(^|[/\s'\"=])\.env(?!\.example)(\.[\w-]+)?(?=$|[\s'\"/;|&)])|\.near-credentials")


def segments(cmd: str):
    # split on ; && || | and newlines, keeping quoted text intact enough for this check
    return [s for s in re.split(r"\|\||&&|[;|\n]", cmd) if s.strip()]


def words(seg: str):
    try:
        return shlex.split(seg, posix=True)
    except ValueError:
        return seg.split()


def reason(cmd: str):
    for seg in segments(cmd):
        w = words(seg)
        # skip leading env assignments and wrappers such as `sudo`, `xargs`, `command`
        while w and (re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", w[0]) or w[0] in {"sudo", "command", "xargs", "nice", "time"}):
            w = w[1:]
        if not w:
            continue
        tool = w[0].rsplit("/", 1)[-1]
        if tool == "git":
            continue  # git grep / git log only see what git tracks; .env is never tracked
        if tool not in TOOLS:
            continue
        if SECRET.search(seg):
            return f"`{tool}` on a secret file (.env / .env.local / .near-credentials). Never search or print them."
        flags = [x for x in w[1:] if x.startswith("-") and not x.startswith("--")]
        if tool in {"grep", "egrep", "fgrep"} and (any(re.search(r"[rR]", f) for f in flags) or "--recursive" in w or "--dereference-recursive" in w):
            return "recursive grep reads .env files too. Use `git grep` (tracked files only)."
        if tool == "rg" and (any("u" in f for f in flags) or {"--hidden", "--no-ignore", "--unrestricted"} & set(w)):
            return "rg with --hidden/--no-ignore/-u reaches .env. Drop the flag or use `git grep`."
    return None


def main():
    data = json.load(sys.stdin)
    cmd = (data.get("tool_input") or {}).get("command", "")
    why = reason(cmd)
    if why:
        print(f"Blocked by .claude/hooks/guard_secret_reads.py: {why}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
