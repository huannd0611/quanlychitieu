"""Local launcher lifecycle tests; no model requests or Windows-only tools."""

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("luma_windows_launcher", ROOT / "windows" / "launch.py")
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class WindowsLauncherTests(unittest.TestCase):
    def test_prompt_masks_keys_without_persisting_or_modifying_parent_environment(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"PATH": "existing-path"}, clear=True), patch.object(sys.stdin, "isatty", return_value=True), patch.object(launcher.getpass, "getpass", side_effect=["test-video-value", "test-planner-value"]) as prompt, contextlib.redirect_stdout(output):
            child_env = launcher.collect_environment(False)
            self.assertNotIn("LUMA_VIDEO_KEY", os.environ)
            self.assertNotIn("LUMA_AI_KEY", os.environ)
        self.assertEqual(prompt.call_count, 2)
        self.assertEqual(child_env["LUMA_VIDEO_KEY"], "test-video-value")
        self.assertEqual(child_env["LUMA_AI_KEY"], "test-planner-value")
        self.assertNotIn("test-video-value", output.getvalue())
        self.assertNotIn("test-planner-value", output.getvalue())

    def test_existing_environment_is_reused_and_no_prompt_mode_is_noninteractive(self):
        with patch.dict(os.environ, {"LUMA_VIDEO_KEY": "test-existing-key", "LUMA_AI_KEY": ""}), patch.object(launcher.getpass, "getpass") as prompt, contextlib.redirect_stdout(io.StringIO()):
            child_env = launcher.collect_environment(True)
        prompt.assert_not_called()
        self.assertEqual(child_env["LUMA_VIDEO_KEY"], "test-existing-key")

    def test_unrelated_port_is_refused_without_terminating_its_owner(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen()
            port = sock.getsockname()[1]
            with patch.object(launcher, "ready", return_value=False), patch.object(launcher.subprocess, "Popen") as spawn, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(launcher.main(["--no-prompt", "--no-browser", "--port", str(port)]), 1)
            spawn.assert_not_called()
            self.assertTrue(launcher.port_in_use(port))

    def test_existing_app_is_reused_without_spawning_a_second_server(self):
        with patch.object(launcher, "ready", return_value=True), patch.object(launcher.subprocess, "Popen") as spawn, patch.object(launcher.webbrowser, "open") as browser, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(launcher.main(["-NoPrompt", "-NoBrowser", "-Port", "8081"]), 0)
        spawn.assert_not_called()
        browser.assert_not_called()

    def test_real_server_starts_becomes_ready_and_stops_with_launcher(self):
        port = free_port()
        env = dict(os.environ, LUMA_VIDEO_KEY="test-value-must-not-print", LUMA_AI_KEY="")
        # The child uses the real app and makes readiness requests only.
        process = subprocess.Popen([sys.executable, "-B", str(ROOT / "windows" / "launch.py"), "--no-prompt", "--no-browser", "--port", str(port)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and not launcher.ready(port):
                self.assertIsNone(process.poll(), "launcher exited before the app became ready")
                time.sleep(.1)
            self.assertTrue(launcher.ready(port), "the real local app should be ready")
            process.terminate()
            output, _ = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0)
            self.assertNotIn("test-value-must-not-print", output)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and launcher.port_in_use(port):
                time.sleep(.1)
            self.assertFalse(launcher.port_in_use(port), "launcher must stop its own server")
        finally:
            if process.poll() is None:
                process.terminate()
                process.communicate(timeout=10)


if __name__ == "__main__":
    unittest.main()
