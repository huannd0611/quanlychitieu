#!/usr/bin/env python3
"""Build reviewable Windows/hosting ZIPs from an explicit source allowlist."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = [
    "server.py", "video_provider.py", "reference_planner.py", "mp4_export.py",
    "index.html", "style.css", "studio.js", "reference.js", "auto.js", "auto.css",
]
COMMON_DOCS = ["README.md", "DEPLOY.md", "tools/package.py"]
WINDOWS = ["START-WINDOWS.cmd", "windows/launch.py", "windows/WINDOWS.md"]
HOSTING = ["Dockerfile", ".dockerignore", "render.yaml"]


def package(output: Path) -> list[Path]:
    output.mkdir(parents=True, exist_ok=True)
    assets = [str(path.relative_to(ROOT)) for path in sorted((ROOT / "assets").glob("*.svg"))]
    distributions = {
        "luma-studio-windows.zip": RUNTIME + assets + COMMON_DOCS + WINDOWS + HOSTING,
        "luma-studio-hosting.zip": RUNTIME + assets + COMMON_DOCS + HOSTING,
    }
    built = []
    for filename, names in distributions.items():
        target = output / filename
        missing = [name for name in names if not (ROOT / name).is_file()]
        if missing:
            raise ValueError("Missing distribution source files: " + ", ".join(missing))
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in names:
                # Never include environments, credentials, caches or user uploads.
                archive.write(ROOT / name, "video-studio/" + name)
        with zipfile.ZipFile(target) as archive:
            if archive.testzip() is not None:
                raise ValueError("ZIP integrity check failed")
        built.append(target)
        print(f"Built {target.name}: {target.stat().st_size:,} bytes")
    checksums = output / "SHA256SUMS.txt"
    checksums.write_text("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in built), encoding="utf-8")
    return built


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parent.parent / "shared" / "luma-downloads")
    package(parser.parse_args().output)
