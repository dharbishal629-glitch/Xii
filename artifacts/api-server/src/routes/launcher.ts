import { Router, type IRouter, type Request, type Response } from "express";
import { getEnvSetting } from "./envSettings";

const router: IRouter = Router();

router.get("/tool/launcher", async (req: Request, res: Response) => {
  // Derive the public URL — priority: DB env_settings > CTRL_API_URL env var > request origin.
  // Using the incoming request's host/protocol as the final fallback means this always
  // produces a valid URL regardless of whether Replit, Render, or any other host is used.
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || req.protocol || "https";
  const host  = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.get("host") || "";
  const requestBase = `${proto}://${host}`;

  const [dbUrl, dbKey, dbTotp] = await Promise.all([
    getEnvSetting("CTRL_API_URL"),
    getEnvSetting("CTRL_API_KEY"),
    getEnvSetting("CTRL_TOTP_SECRET"),
  ]);

  const apiBase    = (dbUrl || process.env.CTRL_API_URL || requestBase).replace(/\/+$/, "");

  // DB env_settings override server env vars — change URL in dashboard without redeploying.
  const apiKey     = dbKey   || process.env.WORKER_API_KEY || "";
  const totpSecret = dbTotp  || process.env.TOTP_SECRET    || "";

  const script = `#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════╗
# ║              CTRL.PNL  —  Secure Tool Launcher                  ║
# ║          Streams & executes tool 100% in-memory                 ║
# ╚══════════════════════════════════════════════════════════════════╝

import sys, os, subprocess, importlib

# ── Step 1: auto-install deps before importing anything coloured ─────────────
REQUIRED = ["requests", "colorama"]

def _installed(pkg):
    try:
        importlib.import_module(pkg.split("[")[0].replace("-", "_"))
        return True
    except ImportError:
        return False

def ensure_deps():
    missing = [p for p in REQUIRED if not _installed(p)]
    if not missing:
        return
    print(f"[*] Auto-installing: {', '.join(missing)} ...")
    for flags in ([], ["--user"]):
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet",
                 "--disable-pip-version-check", *flags, *missing],
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            print(f"[+] Installed. Restarting launcher...")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        except subprocess.CalledProcessError:
            continue
    print(f"[!] Auto-install failed. Run: pip install {' '.join(missing)}")
    sys.exit(1)

ensure_deps()

# ── Step 2: now safe to import coloured libs ─────────────────────────────────
import colorama
from colorama import Style
colorama.init(autoreset=True)

PUR  = "\\033[38;5;141m"
CYN  = "\\033[38;5;51m"
GRN  = "\\033[38;5;82m"
RED  = "\\033[38;5;196m"
YLW  = "\\033[38;5;220m"
GRY  = "\\033[38;5;240m"
WHT  = "\\033[97m"
RST  = Style.RESET_ALL
BLD  = Style.BRIGHT
DIM  = Style.DIM

def p(col, txt):    return f"{col}{txt}{RST}"
def info(m):        print(p(CYN,  "  [*] ") + p(WHT, m))
def ok(m):          print(p(GRN,  "  [+] ") + p(WHT, m))
def warn(m):        print(p(YLW,  "  [!] ") + p(WHT, m))
def err(m):         print(p(RED,  "  [x] ") + p(WHT, m))
def dim_line(m):    print(p(GRY,  "      ") + p(GRY, m))

def banner():
    print()
    print(p(PUR, "  +--------------------------------------------------+"))
    print(p(PUR, "  |") + p(BLD + WHT, "          C T R L . P N L   L A U N C H E R        ") + p(PUR, "|"))
    print(p(PUR, "  |") + p(DIM + CYN, "       In-Memory  .  Authenticated  .  Secure       ") + p(PUR, "|"))
    print(p(PUR, "  +--------------------------------------------------+"))
    print()

# ── Step 3: inject server credentials into environment ───────────────────────
# These values are embedded by the server at download time from its secrets.
# main.py reads them via os.environ — no credentials are hardcoded anywhere.
os.environ.setdefault("CTRL_API_URL",     "${apiBase}")
os.environ.setdefault("CTRL_API_KEY",     "${apiKey}")
os.environ.setdefault("CTRL_TOTP_SECRET", "${totpSecret}")

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    banner()

    import requests

    worker_key = os.environ.get("WORKER_KEY", "").strip()
    if not worker_key:
        print(p(PUR, "  +--------------------------------------------------+"))
        print(p(PUR, "  |") + p(DIM + WHT, "  Enter your worker credentials below             ") + p(PUR, "|"))
        print(p(PUR, "  +--------------------------------------------------+"))
        print()
        worker_key = input(p(CYN, "  Worker Key > ")).strip()
        print()

    if not worker_key:
        err("Worker key is required.")
        sys.exit(1)

    info("Authenticating with server...")

    try:
        r = requests.get(
            f"{os.environ['CTRL_API_URL']}/api/tool/download",
            headers={"x-api-key": worker_key},
            stream=True,
            timeout=60,
        )
    except requests.exceptions.ConnectionError:
        err(f"Cannot reach server: {os.environ['CTRL_API_URL']}")
        dim_line("Check your internet connection or contact your admin.")
        sys.exit(1)
    except requests.exceptions.Timeout:
        err("Server timed out. Try again.")
        sys.exit(1)

    if r.status_code == 401:
        err("Invalid worker key. Contact your admin.")
        sys.exit(1)
    elif r.status_code == 404:
        warn("No tool available yet. Contact your admin.")
        sys.exit(1)
    elif r.status_code != 200:
        err(f"Server error: HTTP {r.status_code}")
        try:    dim_line(r.json().get("error", "Unknown"))
        except: pass
        sys.exit(1)

    cd = r.headers.get("Content-Disposition", "")
    filename = "tool.py"
    if 'filename="' in cd:
        filename = cd.split('filename="')[1].rstrip('"')

    # Pull entire response into RAM — nothing written to disk
    chunks = []
    for chunk in r.iter_content(chunk_size=65536):
        if chunk:
            chunks.append(chunk)
    payload = b"".join(chunks)

    ok(f"Authenticated  |  {p(CYN, filename)}  {p(GRY, f'({len(payload)//1024} KB in-memory)')}")
    print()
    print(p(PUR, "  " + "-" * 50))
    print()

    # ── Execute in-memory ─────────────────────────────────────────────────────
    if filename.endswith(".py"):
        try:
            code_str = payload.decode("utf-8")
        except UnicodeDecodeError:
            err("Payload is not valid UTF-8 Python source.")
            sys.exit(1)

        ns = {
            "__name__": "__main__",
            "__file__": "<secure-memory>",
        }
        try:
            exec(compile(code_str, "<secure-memory>", "exec"), ns)
        except SystemExit as e:
            sys.exit(e.code)
        except Exception as exc:
            err(f"Tool error: {type(exc).__name__}: {exc}")
            sys.exit(1)

    else:
        import tempfile, stat, random, string

        tmp_dir = "/dev/shm" if os.path.isdir("/dev/shm") else tempfile.gettempdir()
        rand_name = "".join(random.choices(string.ascii_lowercase, k=14))
        suffix = os.path.splitext(filename)[1] or ""
        tmp_path = os.path.join(tmp_dir, rand_name + suffix)

        with open(tmp_path, "wb") as f:
            f.write(payload)
        del payload

        try:
            os.chmod(tmp_path, stat.S_IRWXU)
            proc = subprocess.Popen(
                [tmp_path], shell=(sys.platform == "win32")
            )
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            sys.exit(proc.wait())
        except Exception as exc:
            err(f"Launch failed: {exc}")
            try: os.unlink(tmp_path)
            except: pass
            sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        warn("Interrupted.")
        sys.exit(0)
`;

  res.setHeader("Content-Type", "text/x-python");
  res.setHeader("Content-Disposition", 'attachment; filename="launcher.py"');
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.send(script);
});

export default router;
