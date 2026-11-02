"""Hosted-mode HTTP checks; no deployment, external API or real keys involved."""

import base64
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("hosting_studio_server", Path(__file__).resolve().parents[1] / "server.py")
studio = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = studio
SPEC.loader.exec_module(studio)

ORIGIN = "https://luma.example"
PASSWORD = "test-only-owner-password-984"


def basic(username="luma", password=PASSWORD):
    return "Basic " + base64.b64encode(f"{username}:{password}".encode()).decode()


class HostingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = studio.create_server("127.0.0.1", 0, public=True, public_origin=ORIGIN, password=PASSWORD)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.environment = patch.dict(os.environ, {"LUMA_AI_KEY": "", "LUMA_VIDEO_KEY": ""})
        self.environment.start()

    def tearDown(self):
        self.environment.stop()

    def call(self, path="/", *, method="GET", auth=True, origin=None, host="luma.example", headers=None, payload=None):
        selected = {"Host": host}
        if auth:
            selected["Authorization"] = basic() if auth is True else auth
        if origin is not None:
            selected["Origin"] = origin
        if payload is not None:
            selected["Content-Type"] = "application/json"
        selected.update(headers or {})
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=json.dumps(payload).encode() if payload is not None else None, headers=selected)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_missing_or_bad_login_cannot_read_app_or_call_provider(self):
        invalid = [False, basic(password="incorrect"), basic(username="other"), "Basic !!!not-base64!!!", "Bearer token", "Basic /w=="]
        with patch.object(studio.video_provider, "create_job") as create:
            for auth in invalid:
                with self.subTest(auth=bool(auth)):
                    status, headers, body = self.call(auth=auth)
                    self.assertEqual(status, 401)
                    self.assertIn("Basic", headers.get("WWW-Authenticate", ""))
                    self.assertNotIn(PASSWORD.encode(), body)
                    self.assertEqual(self.call("/api/auto/status", auth=auth)[0], 401)
                    self.assertEqual(self.call("/api/video/jobs", method="POST", auth=auth, origin=ORIGIN, payload={})[0], 401)
        create.assert_not_called()

    def test_owner_can_open_editor_and_static_assets_without_exposing_server_files(self):
        status, _, body = self.call()
        self.assertEqual(status, 200)
        self.assertIn(b"Luma Studio", body)
        for path in ["/studio.js", "/auto.js", "/auto.css", "/reference.js", "/assets/logo.svg"]:
            with self.subTest(path=path):
                self.assertEqual(self.call(path)[0], 200)
        for path in ["/server.py", "/video_provider.py", "/.env", "/windows/launch.py", "/tests/test_hosting.py", "/assets/../server.py"]:
            with self.subTest(path=path):
                self.assertEqual(self.call(path)[0], 404)
        status, _, body = self.call("/api/auto/status")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["videoConfigured"])
        self.assertNotIn(PASSWORD.encode(), body)

    def test_public_origin_is_required_for_mutating_requests(self):
        payload = {"prompt": "Natural motion from the image", "mode": "generate", "reference": None,
                   "assets": [{"id": "source-1", "mediaType": "image", "duration": 30}], "useAI": False}
        status, _, body = self.call("/api/auto/plan", method="POST", origin=ORIGIN, payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["method"], "local")
        invalid_origins = [None, "null", "https://other.example", "http://luma.example", "https://luma.example.attacker.invalid", ORIGIN + "/path"]
        with patch.object(studio.video_provider, "create_job") as create, patch.object(studio.video_provider, "cancel_job") as cancel:
            for origin in invalid_origins:
                with self.subTest(origin=origin):
                    self.assertEqual(self.call("/api/video/jobs", method="POST", origin=origin, payload={})[0], 403)
                    self.assertEqual(self.call("/api/video/jobs/" + "a" * 32, method="DELETE", origin=origin)[0], 403)
            self.assertEqual(self.call("/api/video/jobs", method="POST", origin=ORIGIN, headers={"Sec-Fetch-Site": "cross-site"}, payload={})[0], 403)
        create.assert_not_called()
        cancel.assert_not_called()

    def test_host_and_forwarded_headers_cannot_bypass_configured_public_origin(self):
        for host in ["attacker.invalid", "localhost", "127.0.0.1", "luma.example.attacker.invalid", "user@luma.example", "luma.example/path"]:
            with self.subTest(host=host):
                self.assertEqual(self.call(host=host, headers={"X-Forwarded-Host": "luma.example", "X-Forwarded-Proto": "https"})[0], 403)
        self.assertEqual(self.call(headers={"X-Forwarded-Host": "attacker.invalid"})[0], 200)
        self.assertEqual(self.call("/api/auto/plan", method="POST", origin="https://attacker.invalid", headers={"X-Forwarded-Host": "attacker.invalid"}, payload={})[0], 403)

    def test_health_check_is_public_and_reveals_no_configuration(self):
        for host in ["luma.example", "127.0.0.1", "health.internal"]:
            status, _, body = self.call("/healthz", auth=False, host=host)
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), {"status": "ok"})
            self.assertNotIn(PASSWORD.encode(), body)
        status, _, body = self.call("/healthz", method="HEAD", auth=False)
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(self.call("/healthz", method="POST", auth=False, origin=ORIGIN, payload={})[0], 401)


class ServerConfigurationTests(unittest.TestCase):
    def test_unsafe_public_settings_fail_before_start(self):
        for origin, password in [(None, PASSWORD), (ORIGIN, None), (ORIGIN, "short"), ("http://luma.example", PASSWORD),
                                 ("https://user:password@luma.example", PASSWORD), (ORIGIN + "/path", PASSWORD), (ORIGIN + "?query=yes", PASSWORD)]:
            with self.subTest(origin=origin, password_present=bool(password)):
                with self.assertRaises(ValueError):
                    studio.create_server("127.0.0.1", 0, public=True, public_origin=origin, password=password)

    def test_default_local_mode_cannot_bind_all_network_interfaces(self):
        with self.assertRaises(ValueError):
            studio.create_server("0.0.0.0", 0)
        server = studio.create_server("127.0.0.1", 0)
        server.server_close()


if __name__ == "__main__":
    unittest.main()
