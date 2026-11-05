"""Deploy the kredofi.xyz reverse proxy (deploy/cloudflare/worker.js) with the Cloudflare API.

  set -a; source .env; set +a      # CLOUDFLARE_API_TOKEN, PROXY_SECRET (never printed)
  python3 scripts/cf_worker.py status
  python3 scripts/cf_worker.py deploy
  python3 scripts/cf_worker.py cron                # kredofi-cron: hourly seed tick, 6-hourly health watch (GH_DISPATCH_TOKEN)
  python3 scripts/cf_worker.py cron --test M1 M2   # test only: fire at minutes M1 and M2 of the hour; run `cron` again after

deploy: uploads the Worker `kredofi-proxy` with PROXY_SECRET as a secret binding, turns off its
workers.dev address, removes the old registrar parking records for kredofi.xyz / www (listed first),
attaches both hostnames as Worker custom domains (Cloudflare creates the DNS records and certificates),
and turns on Always Use HTTPS, automatic HTTPS rewrites and TLS 1.2 minimum.
The same PROXY_SECRET must be a Space secret (scripts/hf_space.py secrets).
"""
import json, os, sys, urllib.request, urllib.error, uuid
from pathlib import Path

ACCOUNT = "11bd8fa865b1c8299d7566a90f63eb01"
ZONE = "0cca711333daa595c31ebf237a02864e"
NAME = "kredofi-proxy"
HOSTS = ["kredofi.xyz", "www.kredofi.xyz"]
WORKER = Path(__file__).resolve().parent.parent / "deploy" / "cloudflare" / "worker.js"
API = "https://api.cloudflare.com/client/v4"


def token():
    t = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not t: sys.exit("CLOUDFLARE_API_TOKEN not set (set -a; source .env; set +a)")
    return t


def req(method, path, body=None, ctype="application/json"):
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=data, method=method,
                               headers={"Authorization": f"Bearer {token()}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(r) as resp: d = json.load(resp)
    except urllib.error.HTTPError as e:
        d = json.load(e)
    if not d.get("success"): sys.exit(f"{method} {path}: {d.get('errors')}")
    return d.get("result")


def upload():
    secret = os.environ.get("PROXY_SECRET", "")
    if len(secret) < 32: sys.exit("PROXY_SECRET missing or shorter than 32 characters")
    meta = {"main_module": "worker.js", "compatibility_date": "2026-10-01",
            "observability": {"enabled": True},  # keeps the slow/failed upstream lines (paths only) in Workers Logs
            "bindings": [{"type": "secret_text", "name": "PROXY_SECRET", "text": secret}]}
    b = uuid.uuid4().hex
    parts = [
        (f'--{b}\r\nContent-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n'
         f'Content-Type: application/json\r\n\r\n').encode() + json.dumps(meta).encode() + b"\r\n",
        (f'--{b}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n'
         f'Content-Type: application/javascript+module\r\n\r\n').encode() + WORKER.read_bytes() + b"\r\n",
        f"--{b}--\r\n".encode(),
    ]
    req("PUT", f"/accounts/{ACCOUNT}/workers/scripts/{NAME}", b"".join(parts), f"multipart/form-data; boundary={b}")
    req("POST", f"/accounts/{ACCOUNT}/workers/scripts/{NAME}/subdomain", {"enabled": False})
    print(f"uploaded worker {NAME} (secret binding PROXY_SECRET, workers.dev off)")


CRON_NAME = "kredofi-cron"
CRON_WORKER = WORKER.parent / "cron.js"
CRONS = {"17 * * * *": "seed-tick.yml", "47 */6 * * *": "health-watch.yml"}


def cron(test=None):
    """kredofi-cron has no routes and no workers.dev address: it only fires on its schedule."""
    secret = os.environ.get("GH_DISPATCH_TOKEN", "")
    if len(secret) < 20: sys.exit("GH_DISPATCH_TOKEN missing (set -a; source .env; set +a)")
    crons = {f"{test[0]} * * * *": "seed-tick.yml", f"{test[1]} * * * *": "health-watch.yml"} if test else CRONS
    meta = {"main_module": "cron.js", "compatibility_date": "2026-10-01",
            "bindings": [{"type": "secret_text", "name": "GH_DISPATCH_TOKEN", "text": secret},
                         {"type": "plain_text", "name": "CRON_MAP", "text": json.dumps(crons)}]}
    b = uuid.uuid4().hex
    parts = [
        (f'--{b}\r\nContent-Disposition: form-data; name="metadata"; filename="metadata.json"\r\n'
         f'Content-Type: application/json\r\n\r\n').encode() + json.dumps(meta).encode() + b"\r\n",
        (f'--{b}\r\nContent-Disposition: form-data; name="cron.js"; filename="cron.js"\r\n'
         f'Content-Type: application/javascript+module\r\n\r\n').encode() + CRON_WORKER.read_bytes() + b"\r\n",
        f"--{b}--\r\n".encode(),
    ]
    req("PUT", f"/accounts/{ACCOUNT}/workers/scripts/{CRON_NAME}", b"".join(parts), f"multipart/form-data; boundary={b}")
    req("POST", f"/accounts/{ACCOUNT}/workers/scripts/{CRON_NAME}/subdomain", {"enabled": False})
    req("PUT", f"/accounts/{ACCOUNT}/workers/scripts/{CRON_NAME}/schedules", [{"cron": c} for c in crons])
    now = req("GET", f"/accounts/{ACCOUNT}/workers/scripts/{CRON_NAME}/schedules")
    print(f"{CRON_NAME}: secret bound, workers.dev off, schedules {[s['cron'] for s in now['schedules']]} -> {list(crons.values())}")


def domains():
    attached = {d["hostname"] for d in req("GET", f"/accounts/{ACCOUNT}/workers/domains?zone_id={ZONE}") or []}
    for rec in req("GET", f"/zones/{ZONE}/dns_records?per_page=100"):
        if rec["name"] in HOSTS and rec["type"] in ("A", "AAAA", "CNAME") and rec["name"] not in attached:
            print(f"removing old record {rec['type']} {rec['name']} -> {rec['content']}")
            req("DELETE", f"/zones/{ZONE}/dns_records/{rec['id']}")
    for h in HOSTS:
        if h not in attached:
            req("PUT", f"/accounts/{ACCOUNT}/workers/domains",
                {"hostname": h, "service": NAME, "zone_id": ZONE, "environment": "production"})
        print(f"custom domain {h} -> {NAME}")


def settings():
    for k, v in [("always_use_https", "on"), ("automatic_https_rewrites", "on"), ("min_tls_version", "1.2")]:
        req("PATCH", f"/zones/{ZONE}/settings/{k}", {"value": v})
        print(f"zone setting {k} = {v}")


def status():
    print("worker:", [s["id"] for s in req("GET", f"/accounts/{ACCOUNT}/workers/scripts") or []])
    print("domains:", [(d["hostname"], d["service"]) for d in req("GET", f"/accounts/{ACCOUNT}/workers/domains?zone_id={ZONE}") or []])
    for k in ("always_use_https", "min_tls_version", "ssl"):
        print(k, req("GET", f"/zones/{ZONE}/settings/{k}")["value"])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "cron":
        cron(sys.argv[3:5] if "--test" in sys.argv else None)
        sys.exit(0)
    if cmd == "deploy": upload(); domains(); settings()
    status()
