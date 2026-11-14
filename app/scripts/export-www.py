#!/usr/bin/env python3
"""Build app/www/ from the Notan game source and record where it came from.

The game is plain HTML, CSS and JS at the root of this repository (synced from
`notan/` in lukeslp/game-riffs). The native app ships it as a sealed offline
payload. This script is the only thing that writes app/www/, and it changes
the game in exactly these ways, each asserted so a source change that moves
the target fails loudly instead of shipping a half-applied payload:

1. Copies the files listed in the source's runtime.json and nothing else.
2. Removes the GoatCounter <script> from index.html (the app sends nothing).
3. Adds a Content-Security-Policy <meta> that limits every fetch, socket,
   script, style, font and image to the bundled files. With it, the Access
   frame hides its camera and eye-tracker rows (they need WebAssembly or a
   socket to 127.0.0.1), which the app cannot offer anyway.
4. Points Quick play's "Share blank" link at https://playnotan.com/ instead of
   the WebView's own origin (capacitor://localhost or https://localhost),
   which nobody else could open.

Usage (from app/):
    python3 scripts/export-www.py                 # source = repository root, writes www/ + WWW_SOURCE.txt
    python3 scripts/export-www.py --source DIR --out DIR --no-record
                                                  # used by smoke.sh to regenerate and compare
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = APP_DIR.parent

ANALYTICS = re.compile(r'^<script data-goatcounter="[^"]*" async src="https://stats\.dr\.eamer\.dev/count\.js"></script>\n', re.M)
CHARSET = '<meta charset="utf-8">\n'
CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'none'; "
    "object-src 'none'; base-uri 'none'"
)
CSP_META = f'<meta http-equiv="Content-Security-Policy" content="{CSP}">\n'
SHARE_FROM = "const url = location.origin + location.pathname + '?endless='"
SHARE_TO = "const url = 'https://playnotan.com/?endless='"
OFF_DEVICE = re.compile(r'<(script|link|img|iframe|source|audio|video)\b[^>]*\b(src|href)="(https?:)?//', re.I)


def die(message: str) -> None:
    print(f"export-www: {message}", file=sys.stderr)
    sys.exit(1)


def replace_once(text: str, old: str, new: str, what: str) -> str:
    count = text.count(old)
    if count != 1:
        die(f"{what}: expected exactly one match, found {count}. The game source changed; update scripts/export-www.py.")
    return text.replace(old, new)


def export(source: Path, out: Path) -> list[str]:
    runtime = json.loads((source / "runtime.json").read_text())
    files = sorted(set(runtime["files"]) | {runtime["entry"]})
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for rel in files:
        src = source / rel
        if not src.is_file():
            die(f"runtime.json lists {rel}, which is not in {source}")
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)

    index = out / "index.html"
    html = index.read_text()
    if len(ANALYTICS.findall(html)) != 1:
        die("index.html: expected exactly one GoatCounter <script> line")
    html = ANALYTICS.sub("", html)
    html = replace_once(html, CHARSET, CHARSET + CSP_META, "index.html charset meta")
    # <link rel="canonical"> names the web address; it loads nothing.
    bad = [m.group(0) for m in OFF_DEVICE.finditer(html) if 'rel="canonical"' not in m.group(0)]
    if bad:
        die(f"index.html still loads something off the device: {bad}")
    index.write_text(html)

    game = out / "notan.js"
    game.write_text(replace_once(game.read_text(), SHARE_FROM, SHARE_TO, "notan.js share link"))
    return files


def git(source: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(source), *args], check=True, capture_output=True, text=True).stdout.strip()


def record(source: Path, out: Path) -> None:
    game_files = [*json.loads((source / "runtime.json").read_text())["files"], "runtime.json"]
    dirty = git(source, "status", "--porcelain", "--untracked-files=no", "--", *game_files)
    if dirty:
        die("the game source has uncommitted changes; commit them before exporting so the payload has a source commit")
    # The last commit that touched the game files (normally a sync from
    # game-riffs), not HEAD: commits under app/ do not change the game.
    commit = git(source, "log", "-1", "--format=%H", "--", *game_files)
    subject = git(source, "log", "-1", "--format=%s", commit)
    upstream = re.search(r"from game-riffs ([0-9a-f]{7,40})", subject)
    lines = [
        "# Vendored payload provenance. Do not hand-edit www/.",
        "#",
        "# Regenerate from app/ at the source commit below:",
        "#   python3 scripts/export-www.py",
        "# scripts/smoke.sh verifies these checksums; scripts/export-www.py lists",
        "# the three deliberate differences from the web game.",
        "",
        "source_repo     https://github.com/lukeslp/notan",
        f"source_commit   {commit}",
    ]
    if upstream:
        lines.append(f"upstream        https://github.com/lukeslp/game-riffs notan/ at {upstream.group(1)}")
    lines.append("")
    for path in sorted(p for p in out.rglob("*") if p.is_file()):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.relative_to(out).as_posix()}")
    (APP_DIR / "WWW_SOURCE.txt").write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=REPO_ROOT, help="Notan game folder (default: repository root)")
    parser.add_argument("--out", type=Path, default=APP_DIR / "www", help="output folder (default: app/www)")
    parser.add_argument("--no-record", action="store_true", help="do not rewrite WWW_SOURCE.txt")
    args = parser.parse_args()
    source, out = args.source.resolve(), args.out.resolve()
    files = export(source, out)
    if not args.no_record:
        record(source, out)
    print(f"export-www: {len(files)} files from {source} -> {out}")


if __name__ == "__main__":
    main()
