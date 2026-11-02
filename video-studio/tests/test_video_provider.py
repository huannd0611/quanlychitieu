"""Offline coverage for genuine generation integration; no billable requests."""
import base64
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib import error, request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import video_provider as provider


# A complete, real 1x1 PNG, not an arbitrary string with an image extension.
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
IMAGE = "data:image/png;base64," + PNG
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"test-encoded-content"


class Response(io.BytesIO):
    def __init__(self, value, headers=None):
        super().__init__(json.dumps(value).encode() if isinstance(value, dict) else value)
        self.headers = headers or {}


class VideoProviderTests(unittest.TestCase):
    def setUp(self):
        with provider._lock:
            provider._jobs.clear()
            provider._request_ids.clear()
        self.payload = {"image": IMAGE, "prompt": "Máy quay tiến nhẹ vào sản phẩm, ánh sáng tự nhiên.", "duration": 5, "clientRequestId": "test-request-id-0001"}

    def submit(self):
        with patch.object(provider, "_open", return_value=Response({"request_id": "external-safe-id", "status": "IN_QUEUE"})):
            return provider.create_job(self.payload, "test-secret-never-return")

    def assert_error(self, code, fn, *args):
        with self.assertRaises(provider.VideoError) as caught:
            fn(*args)
        self.assertEqual(caught.exception.status_code, code)
        self.assertNotIn("test-secret-never-return", str(caught.exception))
        return str(caught.exception)

    def test_create_uses_real_fixed_model_data_uri_and_safe_public_id(self):
        calls = []
        def fake_open(req, **kwargs):
            calls.append(req)
            return Response({"request_id": "external-safe-id", "status": "IN_QUEUE", "status_url": "https://evil.invalid/steal"})
        with patch.object(provider, "_open", side_effect=fake_open):
            result = provider.create_job(self.payload, "test-secret-never-return")
        self.assertEqual(calls[0].full_url, "https://queue.fal.run/" + provider.MODEL)
        self.assertEqual(calls[0].method, "POST")
        self.assertEqual(calls[0].get_header("Authorization"), "Key test-secret-never-return")
        body = json.loads(calls[0].data)
        self.assertEqual(body["duration"], "5")
        self.assertEqual(body["image_url"], IMAGE)
        self.assertEqual(result["status"], "queued")
        self.assertNotEqual(result["id"], "external-safe-id")
        self.assertNotIn("test-secret-never-return", json.dumps(result))
        self.assertNotIn("status_url", result)

    def test_queue_running_completed_and_download_without_authorization(self):
        job = self.submit()
        responses = [Response({"status": "IN_PROGRESS", "progress": 35}), Response({"status": "COMPLETED"}), Response({"video": {"url": "https://v3.fal.media/files/test/video.mp4"}}), Response(MP4, {"Content-Length": str(len(MP4))})]
        calls = []
        def fake_open(req, **kwargs):
            calls.append((req, kwargs))
            return responses.pop(0)
        with patch.object(provider, "_open", side_effect=fake_open):
            running = provider.get_job(job["id"], "test-secret-never-return")
            done = provider.get_job(job["id"], "test-secret-never-return")
            body, mime = provider.get_content(job["id"], "test-secret-never-return")
        self.assertEqual(running["status"], "processing")
        self.assertEqual(running["progress"], 35)
        self.assertEqual(done["status"], "completed")
        self.assertEqual(done["content_url"], f"/api/video/jobs/{job['id']}/content")
        self.assertNotIn("fal.media", json.dumps(done))
        self.assertEqual(body, MP4)
        self.assertEqual(mime, "video/mp4")
        self.assertEqual(calls[0][0].full_url, provider.REQUEST_BASE + "external-safe-id/status")
        self.assertEqual(calls[2][0].full_url, provider.REQUEST_BASE + "external-safe-id")
        self.assertIsNone(calls[3][0].get_header("Authorization"))
        self.assertTrue(calls[3][1]["media"])

    def test_duplicate_retry_does_not_submit_twice_and_rejects_changed_payload(self):
        with patch.object(provider, "_open", return_value=Response({"request_id": "safe-id", "status": "IN_QUEUE"})) as opened:
            first = provider.create_job(self.payload, "test-secret-never-return")
            second = provider.create_job(self.payload, "test-secret-never-return")
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(opened.call_count, 1)
            self.assert_error(409, provider.create_job, {**self.payload, "prompt": "Khác"}, "test-secret-never-return")

    def test_concurrent_same_token_reserves_one_billable_request(self):
        entered, release = threading.Event(), threading.Event()
        def fake_open(*args, **kwargs):
            entered.set()
            release.wait(2)
            return Response({"request_id": "safe-id", "status": "IN_QUEUE"})
        with patch.object(provider, "_open", side_effect=fake_open) as opened, ThreadPoolExecutor(2) as pool:
            first = pool.submit(provider.create_job, self.payload, "test-secret-never-return")
            self.assertTrue(entered.wait(1))
            second = pool.submit(provider.create_job, self.payload, "test-secret-never-return")
            intermediate = second.result(timeout=1)
            self.assertEqual(intermediate["status"], "submitting")
            release.set()
            self.assertEqual(first.result()["id"], intermediate["id"])
            self.assertEqual(opened.call_count, 1)

    def test_timeout_keeps_token_to_prevent_duplicate_paid_creation(self):
        with patch.object(provider, "_open", side_effect=TimeoutError("test-secret-never-return")) as opened:
            self.assert_error(502, provider.create_job, self.payload, "test-secret-never-return")
            retry = provider.create_job(self.payload, "test-secret-never-return")
            self.assertEqual(retry["status"], "failed")
            self.assertEqual(opened.call_count, 1)

    def test_missing_key_invalid_image_and_provider_ids_never_call_network(self):
        with patch.object(provider, "_open") as opened:
            self.assert_error(503, provider.create_job, self.payload, "")
            for value in ["https://example.com/photo.png", "data:image/png;base64,bm90IGFuIGltYWdl", "data:image/gif;base64," + PNG]:
                self.assert_error(400, provider.create_job, {**self.payload, "image": value}, "test-secret-never-return")
            for value in [True, 4, 12, "5", [], {}]:
                self.assert_error(400, provider.create_job, {**self.payload, "duration": value}, "test-secret-never-return")
            self.assert_error(400, provider.create_job, {**self.payload, "prompt": " "}, "test-secret-never-return")
            self.assert_error(404, provider.get_job, "../../other-job", "test-secret-never-return")
            self.assertFalse(opened.called)
        with patch.object(provider, "_open", return_value=Response({"request_id": "../../evil", "status": "IN_QUEUE"})):
            self.assert_error(502, provider.create_job, self.payload, "test-secret-never-return")

    def test_active_queue_limit(self):
        for index in range(4):
            with patch.object(provider, "_open", return_value=Response({"request_id": f"safe-{index}", "status": "IN_QUEUE"})):
                provider.create_job({**self.payload, "clientRequestId": f"client-request-{index:04d}"}, "test-secret-never-return")
        with patch.object(provider, "_open") as opened:
            self.assert_error(429, provider.create_job, {**self.payload, "clientRequestId": "one-more-client-0001"}, "test-secret-never-return")
            self.assertFalse(opened.called)

    def test_cancel_is_put_and_waits_for_provider_confirmation(self):
        job = self.submit()
        with patch.object(provider, "_open", return_value=Response(b"")) as opened:
            result = provider.cancel_job(job["id"], "test-secret-never-return")
            self.assertEqual(opened.call_args.args[0].method, "PUT")
            self.assertEqual(opened.call_args.args[0].full_url, provider.REQUEST_BASE + "external-safe-id/cancel")
        self.assertEqual(result["status"], "cancel_requested")
        with patch.object(provider, "_open", return_value=Response({"status": "CANCELLED"})):
            self.assertEqual(provider.get_job(job["id"], "test-secret-never-return")["status"], "cancelled")

    def test_failures_are_sanitized_and_terminal(self):
        job = self.submit()
        with patch.object(provider, "_open", return_value=Response({"status": "FAILED", "error": "test-secret-never-return"})):
            result = provider.get_job(job["id"], "test-secret-never-return")
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("test-secret-never-return", json.dumps(result))
        self.assert_error(409, provider.get_content, job["id"], "test-secret-never-return")
        with patch.object(provider, "_open", side_effect=error.HTTPError("unused", 403, "test-secret-never-return", {}, io.BytesIO(b"test-secret-never-return"))):
            self.assert_error(502, provider.create_job, {**self.payload, "clientRequestId": "another-client-0001"}, "test-secret-never-return")

    def test_untrusted_result_url_and_redirects_are_blocked(self):
        bad = ["http://fal.media/x", "https://fal.media.evil.invalid/x", "https://127.0.0.1/x", "https://fal.media@evil.invalid/x", "https://fal.media:444/x", "https://v3.fal.media/x#frag"]
        for url in bad:
            self.assert_error(502, provider._safe_output_url, url)
        self.assertEqual(provider._safe_output_url("https://v3.fal.media/file/video.mp4"), "https://v3.fal.media/file/video.mp4")
        req = request.Request("https://v3.fal.media/file/video.mp4")
        self.assert_error(502, provider._MediaRedirects().redirect_request, req, None, 302, "Found", {}, "https://evil.invalid/video.mp4")
        self.assert_error(502, provider._QueueRedirects().redirect_request, req, None, 302, "Found", {}, "https://queue.fal.run/another")
        job = self.submit()
        with patch.object(provider, "_open", side_effect=[Response({"status": "COMPLETED"}), Response({"video": {"url": "https://evil.invalid/secret"}})]):
            self.assert_error(502, provider.get_job, job["id"], "test-secret-never-return")

    def test_content_size_and_media_magic_are_checked(self):
        job = self.submit()
        with provider._lock:
            provider._jobs[job["id"]].update(status="completed", video_url="https://v3.fal.media/video.mp4")
        with patch.object(provider, "_open", return_value=Response(b"", {"Content-Length": str(provider.MAX_CONTENT + 1)})):
            self.assert_error(502, provider.get_content, job["id"], "test-secret-never-return")
        with patch.object(provider, "_open", return_value=Response(b"upstream error that is not a video")):
            self.assert_error(502, provider.get_content, job["id"], "test-secret-never-return")

    def test_verified_tls_and_inherited_proxy_opener_are_preserved(self):
        req = request.Request("https://queue.fal.run/test")
        with patch.object(provider.request, "build_opener") as build:
            provider._open(req)
            self.assertEqual(len(build.call_args.args), 1)
            self.assertIsInstance(build.call_args.args[0], provider._QueueRedirects)
            build.return_value.open.assert_called_once_with(req, timeout=40)


if __name__ == "__main__":
    unittest.main()
