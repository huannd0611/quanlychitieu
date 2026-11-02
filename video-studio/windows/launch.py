#!/usr/bin/env python3
"""Start Luma on this computer, optionally prompt for keys without saving them.

Used by START-WINDOWS.cmd. Also runs on Python 3.10+ on other platforms so the
startup lifecycle can be checked without a Windows machine.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib import error, request
import webbrowser


ROOT = Path(__file__).resolve().parents[1]


def ready(port: int) -> bool:
    """Probe only our loopback app, without sending credentials or using proxies."""
    opener = request.build_opener(request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{port}/api/auto/status", timeout=.6) as response:
            if response.status != 200:
                return False
            data = json.loads(response.read(8192))
        return (
            isinstance(data, dict)
            and isinstance(data.get("plannerConfigured"), bool)
            and isinstance(data.get("videoConfigured"), bool)
            and data.get("videoProvider") == "fal.ai"
        )
    except (error.URLError, OSError, ValueError):
        return False


def port_in_use(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=.5):
            return True
    except OSError:
        return False


def collect_environment(no_prompt: bool) -> dict[str, str]:
    """Keys live only in the child environment; do not write a file or print them."""
    child_env = dict(os.environ)
    for name, label in [("LUMA_VIDEO_KEY", "fal.ai (image-to-video)"), ("LUMA_AI_KEY", "OpenAI (understand reference images/video)")]:
        if child_env.get(name, "").strip():
            print(f"Using the configured {label} key.")
            continue
        if no_prompt or not sys.stdin.isatty():
            continue
        print(f"Optional {label} key. Press Enter to skip.")
        # getpass uses the Windows console API; typed keys are not displayed.
        value = getpass.getpass("API key (hidden): ").strip()
        if value:
            child_env[name] = value
    return child_env


def stop_child(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start Luma Studio on this computer. Keys are never saved by this launcher.")
    parser.add_argument("--port", "-Port", type=int, default=8081)
    parser.add_argument("--no-prompt", "-NoPrompt", action="store_true", help="Use existing environment variables, without prompting for keys")
    parser.add_argument("--no-browser", "-NoBrowser", action="store_true", help="Do not open a browser automatically")
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    if sys.version_info < (3, 10):
        print("Python 3.10 or newer is required.", file=sys.stderr)
        return 1
    if not (ROOT / "server.py").is_file():
        print("server.py is missing. Extract the whole ZIP before starting Luma Studio.", file=sys.stderr)
        return 1

    url = f"http://127.0.0.1:{args.port}/"
    if ready(args.port):
        print(f"Luma Studio is already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return 0
    if port_in_use(args.port):
        print(f"Port {args.port} belongs to another program. Leave it running and start Luma with --port 8082.", file=sys.stderr)
        return 1

    print("Luma Studio - local Windows edition")
    print("The editor works without API keys. Generating new AI motion needs a paid fal.ai account.")
    child_env = collect_environment(args.no_prompt)
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("FFmpeg/FFprobe is not installed: native MP4/WebM recording can work; MP4 conversion needs FFmpeg in PATH.")
    process = None
    try:
        process = subprocess.Popen([sys.executable, "-B", str(ROOT / "server.py"), "--port", str(args.port)], cwd=ROOT, env=child_env)
        # Handling termination here lets tests and the user stop only this child.
        def interrupted(_signum, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, interrupted)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if process.poll() is not None:
                print("The server stopped before it was ready. Check the message above.", file=sys.stderr)
                return 1
            if ready(args.port):
                break
            time.sleep(.15)
        else:
            print("The server did not become ready. Retry with another port or read WINDOWS.md.", file=sys.stderr)
            return 1
        print(f"Open {url}")
        print("Keep this window open. Press Ctrl+C to stop Luma Studio.")
        print("Wait for AI generation/export to finish before stopping.")
        if not args.no_browser:
            webbrowser.open(url)
        while process.poll() is None:
            time.sleep(.4)
        return process.returncode or 0
    except KeyboardInterrupt:
        print("\nStopping the local Luma Studio server.")
        return 0
    except OSError as exc:
        print(f"Could not start the local Python server ({type(exc).__name__}).", file=sys.stderr)
        return 1
    finally:
        if process is not None:
            stop_child(process)


if __name__ == "__main__":
    raise SystemExit(main())
