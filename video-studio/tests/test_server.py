"""Offline AI/API contract tests. No provider requests or credentials are needed."""

import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib import error, request


SPEC = importlib.util.spec_from_file_location("studio_server", Path(__file__).resolve().parents[1] / "server.py")
studio = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(studio)


def input_data():
    return {"prompt": "Một video Reels về bình yên.", "ratio": "9:16", "clips": [{"id": "clip-1", "caption": "Xin chào", "duration": 3, "mediaType": "image"}, {"id": "clip-2", "caption": "Tạm biệt", "duration": 4, "mediaType": "video"}]}


def plan_data():
    return {"ratio": "9:16", "style": "natural", "transition": "fade", "scenes": [{"id": "clip-2", "caption": "Bước chậm một chút.", "duration": 2.5}, {"id": "clip-1", "caption": "Để nhớ thật lâu.", "duration": 3}]}


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = studio.ThreadingHTTPServer(("127.0.0.1", 0), studio.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.environ = patch.dict(os.environ, {"LUMA_AI_KEY": "", "LUMA_VIDEO_KEY": "", "LUMA_AI_MODEL": "gpt-4.1-mini"})
        self.environ.start()
        # Local HTTP test transport does not use inherited remote proxies.
        self.opener = request.build_opener(request.ProxyHandler({}))

    def tearDown(self):
        self.environ.stop()

    def call(self, path, payload=None, headers=None):
        selected_headers = {"Content-Type": "application/json"}
        selected_headers.update(headers or {})
        req = request.Request(self.base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=selected_headers)
        try:
            with self.opener.open(req, timeout=5) as response:
                return response.status, response.read()
        except error.HTTPError as exc:
            return exc.code, exc.read()

    def test_status_does_not_expose_key(self):
        status, body = self.call("/api/ai/status")
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(body)["configured"])
        with patch.dict(os.environ, {"LUMA_AI_KEY": "private-key-never-return"}):
            status, body = self.call("/api/ai/status")
        self.assertTrue(json.loads(body)["configured"])
        self.assertNotIn(b"private-key", body)

    def test_auto_status_and_explicit_local_planning_do_not_send_data(self):
        payload = {"mode": "generate", "prompt": "Chuyển động tự nhiên của chủ thể", "reference": None,
                   "assets": [{"id": "asset-1", "mediaType": "image", "duration": 30, "frames": []}], "useAI": False}
        with patch.dict(os.environ, {"LUMA_AI_KEY": "test-private-planner", "LUMA_VIDEO_KEY": "test-private-video"}), patch.object(studio.reference_planner, "create_plan") as ai:
            status, body = self.call("/api/auto/status")
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(body)["videoConfigured"])
            self.assertNotIn(b"test-private", body)
            status, body = self.call("/api/auto/plan", payload, {"Origin": self.base})
        ai.assert_not_called()
        self.assertEqual(status, 200)
        response = json.loads(body)
        self.assertEqual(response["method"], "local")
        self.assertEqual(response["plan"]["scenes"][0]["assetId"], "asset-1")
        self.assertTrue(response["plan"]["scenes"][0]["generationPrompt"])
        payload["useAI"] = True
        self.assertEqual(self.call("/api/auto/plan", payload)[0], 503)
        payload["useAI"] = "true"
        self.assertEqual(self.call("/api/auto/plan", payload)[0], 400)

    def test_video_job_routes_keep_remote_credentials_and_content_server_side(self):
        local_id = "a" * 32
        payload = {"image": "data:image/png;base64,test", "prompt": "Slow natural motion", "duration": 5, "clientRequestId": "unique-request-1234"}
        with patch.object(studio.video_provider, "create_job", return_value={"id": local_id, "status": "queued"}) as create:
            status, body = self.call("/api/video/jobs", payload, {"Origin": self.base})
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(body)["id"], local_id)
        self.assertEqual(create.call_args.args[0]["clientRequestId"], payload["clientRequestId"])
        with patch.object(studio.video_provider, "get_content", return_value=(b"encoded-video-content", "video/mp4")):
            status, content = self.call(f"/api/video/jobs/{local_id}/content")
        self.assertEqual(status, 200)
        self.assertEqual(content, b"encoded-video-content")
        with patch.object(studio.video_provider, "cancel_job", return_value={"id": local_id, "status": "cancel_requested"}) as cancel:
            req = request.Request(self.base + f"/api/video/jobs/{local_id}", method="DELETE", headers={"Origin": self.base})
            with self.opener.open(req) as response:
                self.assertEqual(json.load(response)["status"], "cancel_requested")
        cancel.assert_called_once()
        status, _ = self.call("/api/video/jobs", payload, {"Origin": "https://other.invalid"})
        self.assertEqual(status, 403)
        # Missing configured credentials never trigger an upstream generation.
        with patch.object(studio.video_provider, "_json_call") as upstream:
            self.assertEqual(self.call("/api/video/jobs", payload)[0], 503)
        upstream.assert_not_called()

    def test_missing_key_has_useful_error_without_provider_call(self):
        with patch.object(studio.request, "urlopen") as upstream:
            status, body = self.call("/api/ai/storyboard", input_data())
        self.assertEqual(status, 503)
        self.assertIn("LUMA_AI_KEY", json.loads(body)["error"])
        upstream.assert_not_called()

    def test_same_origin_only_and_host_validation(self):
        for headers in [{"Origin": "https://attacker.invalid"}, {"Sec-Fetch-Site": "cross-site"}, {"Host": "attacker.invalid"}]:
            with self.subTest(headers=headers):
                status, _ = self.call("/api/ai/storyboard", input_data(), headers)
                self.assertEqual(status, 403)
        status, _ = self.call("/api/ai/storyboard", input_data(), {"Origin": self.base})
        self.assertEqual(status, 503)

    def test_invalid_input_is_rejected_before_api_call(self):
        candidates = []
        data = input_data(); data["prompt"] = ""; candidates.append(data)
        data = input_data(); data["ratio"] = "file:///etc/passwd"; candidates.append(data)
        data = input_data(); data["ratio"] = []; candidates.append(data)
        data = input_data(); data["clips"][0]["mediaType"] = {}; candidates.append(data)
        data = input_data(); data["clips"][1]["id"] = "clip-1"; candidates.append(data)
        data = input_data(); data["clips"][0]["duration"] = float("nan"); candidates.append(data)
        data = input_data(); data["clips"][0]["thumbnail"] = "https://private.invalid/image.png"; candidates.append(data)
        data = input_data(); data["clips"][0]["thumbnail"] = "data:image/png;base64,aGVsbG8="; candidates.append(data)
        with patch.object(studio.request, "urlopen") as upstream:
            for data in candidates:
                with self.subTest(data=data):
                    self.assertEqual(self.call("/api/ai/storyboard", data)[0], 400)
        upstream.assert_not_called()

    def test_real_http_handler_with_structured_provider_response_and_image(self):
        payload = input_data()
        payload["clips"][0]["thumbnail"] = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nimage-sample").decode()
        response = {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(plan_data())}]}]}
        with patch.dict(os.environ, {"LUMA_AI_KEY": "test-key-only"}), patch.object(studio.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as upstream:
            status, body = self.call("/api/ai/storyboard", payload, {"Origin": self.base})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"plan": plan_data()})
        req = upstream.call_args.args[0]
        self.assertEqual(req.full_url, studio.API_URL)
        sent = json.loads(req.data)
        self.assertEqual(sent["model"], "gpt-4.1-mini")
        self.assertEqual(sent["text"]["format"]["type"], "json_schema")
        self.assertEqual(upstream.call_args.kwargs["timeout"], 60)
        self.assertTrue(any(part["type"] == "input_image" for part in sent["input"][0]["content"]))
        self.assertFalse(sent["store"])
        self.assertNotIn(b"test-key-only", body)

    def test_provider_error_body_is_never_returned(self):
        failure = error.HTTPError(studio.API_URL, 401, "Secret upstream details", {}, io.BytesIO(b"sensitive body"))
        with patch.dict(os.environ, {"LUMA_AI_KEY": "private-key-never-return"}), patch.object(studio.request, "urlopen", side_effect=failure):
            status, body = self.call("/api/ai/storyboard", input_data())
        self.assertEqual(status, 502)
        self.assertNotIn(b"sensitive", body)
        self.assertNotIn(b"private-key", body)
        self.assertNotIn(b"Secret", body)

    def test_hallucinated_or_missing_clip_rejected(self):
        for scenes in [[{"id": "invented", "caption": "Hi", "duration": 2}, {"id": "clip-1", "caption": "Hi", "duration": 3}], [{"id": "clip-1", "caption": "Hi", "duration": 2}]]:
            plan = plan_data(); plan["scenes"] = scenes
            with self.subTest(scenes=scenes), self.assertRaises(studio.ProviderError):
                studio.validate_plan(plan, {"clip-1", "clip-2"})

    def test_static_assets_only_no_source_or_traversal(self):
        status, body = self.call("/")
        self.assertEqual(status, 200)
        self.assertIn(b"Luma Studio", body)
        for path in ["/server.py", "/tests/test_server.py", "/.env", "/assets/../server.py", "/assets/%2e%2e/server.py", "/assets/"]:
            with self.subTest(path=path):
                self.assertEqual(self.call(path)[0], 404)
        self.assertEqual(self.call("/assets/logo.svg")[0], 200)


if __name__ == "__main__":
    unittest.main()
