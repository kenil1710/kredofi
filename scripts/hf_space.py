#!/usr/bin/env python3
"""KredoFi on a Hugging Face Docker Space (docs/DEPLOY_HF.md).

Run with uv (no install needed):
  uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py stage
  uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py create  --space <user>/kredofi
  uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py secrets --space <user>/kredofi
  uv run --with huggingface_hub==0.36.0 python scripts/hf_space.py push    --space <user>/kredofi

stage   builds build/hf-space/ from git-tracked web files + the pinned demo scorer + deploy/hf/,
        then scans every staged byte for every secret value in .env and web/.env.local. Fails on any hit.
create  creates the public Docker Space (exists_ok).
secrets sets the Space secrets from web/.env.local (testnet keys). Refuses the mainnet SEAL_KEY.
push    stage + scan, then uploads build/hf-space/ to the Space (replacing its files).

The HF token is read from HF_TOKEN (environment or .env). No value is ever printed.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "build" / "hf-space"
WASM = ROOT / "scorer" / "out" / "kredofi_scorer_demo.wasm"
CONTRACT = "kredofi.kency.testnet"
RPC = "https://rpc.testnet.near.org"
# Runtime secrets the server needs (web/src/server/*). Everything else is in the Dockerfile.
SECRET_KEYS = ["PLAID_CLIENT_ID", "PLAID_SECRET", "SEAL_KEY", "NEARAI_KEY", "DEV_SCORER_ACCOUNT_ID",
               "DEV_SCORER_KEY", "RELAYER_ACCOUNT_ID", "RELAYER_KEY", "NEAR_RPC_URLS"]
# Values that are public by design (account names, URLs); not treated as secrets by the scan.
PUBLIC_KEYS = {"DEV_SCORER_ACCOUNT_ID", "RELAYER_ACCOUNT_ID", "NEAR_RPC_URLS", "SCORER_WASM", "SCORER_OUT_DIR",
               "LEDGER_CACHE", "PARTNER_PUBKEY", "SCORER_OUT", "NEXT_PUBLIC_NEAR_NETWORK"}


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def read_env(path):
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def pinned_version():
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": {
        "request_type": "call_function", "finality": "final", "account_id": CONTRACT,
        "method_name": "get_config", "args_base64": ""}}).encode()
    req = urllib.request.Request(RPC, body, {"content-type": "application/json"})
    res = json.load(urllib.request.urlopen(req, timeout=20))
    return json.loads(bytes(res["result"]["result"]))["scorer_version"]


def stage():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)
    # Only files git tracks under web/ (never .env.local, node_modules, .next, .data), minus tests.
    files = subprocess.run(["git", "ls-files", "web"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.split()
    files = [f for f in files if not f.endswith(".test.ts") and "/.env" not in f and not Path(f).name.startswith(".env")]
    for f in files:
        dst = STAGE / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, dst)
    shutil.copy2(ROOT / "deploy" / "hf" / "Dockerfile", STAGE / "Dockerfile")
    shutil.copy2(ROOT / "deploy" / "hf" / "README.md", STAGE / "README.md")
    if not WASM.exists():
        die("scorer/out/kredofi_scorer_demo.wasm missing: run (cd scorer && ./build.sh demo)")
    digest = hashlib.sha256(WASM.read_bytes()).hexdigest()
    pinned = pinned_version()
    if digest != pinned:
        die(f"demo scorer {digest[:8]}... is not the version pinned on {CONTRACT} ({pinned[:8]}...)")
    dockerfile = (STAGE / "Dockerfile").read_text()
    if f"SCORER_SHA256={digest}" not in dockerfile:
        die("deploy/hf/Dockerfile SCORER_SHA256 does not match the demo scorer")
    (STAGE / "scorer" / "out").mkdir(parents=True)
    shutil.copy2(WASM, STAGE / "scorer" / "out" / WASM.name)
    scan()
    n = sum(1 for p in STAGE.rglob("*") if p.is_file())
    print(f"staged {n} files in build/hf-space (scorer {digest[:8]}..., pinned on {CONTRACT}); secret scan clean")


def scan():
    """Fail if any secret value from .env or web/.env.local appears in any staged file."""
    values = {}
    for path in (ROOT / ".env", ROOT / "web" / ".env.local"):
        for k, v in read_env(path).items():
            if k not in PUBLIC_KEYS and len(v) >= 8:
                values.setdefault(v, set()).add(k)
    key_pat = re.compile(rb"ed25519:[1-9A-HJ-NP-Za-km-z]{80,}")
    hits = set()
    for p in STAGE.rglob("*"):
        if not p.is_file():
            continue
        data = p.read_bytes()
        for v, keys in values.items():
            if v.encode() in data:
                hits.add(f"{p.relative_to(STAGE)}: value of {'/'.join(sorted(keys))}")
        if key_pat.search(data):
            hits.add(f"{p.relative_to(STAGE)}: something that looks like an ed25519 private key")
    if hits:
        die("secret found in staged files (values not shown):\n  " + "\n  ".join(sorted(hits)))


def api():
    from huggingface_hub import HfApi
    token = os.environ.get("HF_TOKEN") or read_env(ROOT / ".env").get("HF_TOKEN")
    if not token:
        die("HF_TOKEN not set (add it to .env; never commit it)")
    return HfApi(token=token)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stage", "create", "secrets", "push"])
    ap.add_argument("--space", help="<hf user>/<space name>, e.g. kenil1710/kredofi")
    ap.add_argument("--hardware", default=None, help="create on paid hardware, e.g. cpu-upgrade (billed to the account)")
    a = ap.parse_args()
    if a.cmd != "stage" and not (a.space and re.fullmatch(r"[\w.-]+/[\w.-]+", a.space)):
        die("--space <user>/<name> is required")

    if a.cmd == "stage":
        stage()
    elif a.cmd == "create":
        url = api().create_repo(a.space, repo_type="space", space_sdk="docker", private=False, exist_ok=True,
                                space_hardware=a.hardware)
        print(f"Space ready: {url}")
    elif a.cmd == "secrets":
        web = read_env(ROOT / "web" / ".env.local")
        mainnet_seal = read_env(ROOT / ".env").get("SEAL_KEY")
        if not web.get("SEAL_KEY") or web.get("SEAL_KEY") == mainnet_seal:
            die("web/.env.local SEAL_KEY is missing or equals the mainnet SEAL_KEY; refusing")
        missing = [k for k in SECRET_KEYS if not web.get(k) and k not in ("NEARAI_KEY", "NEAR_RPC_URLS")]  # both optional
        if missing:
            die(f"missing in web/.env.local: {', '.join(missing)}")
        h = api()
        for k in SECRET_KEYS:
            if web.get(k):
                h.add_space_secret(a.space, k, web[k])
                print(f"set secret {k}")
    elif a.cmd == "push":
        stage()
        info = api().upload_folder(folder_path=str(STAGE), repo_id=a.space, repo_type="space",
                                   commit_message="Deploy KredoFi (testnet)", delete_patterns=["web/**", "scorer/**"])
        print(f"pushed: {info}")


if __name__ == "__main__":
    main()
