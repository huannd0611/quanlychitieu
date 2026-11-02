"""Image-to-video jobs using fal.ai's Kling queue API.

Only the fixed queue endpoint and HTTPS fal.media outputs are accessed. Secrets
are supplied by the server process and never retained in jobs or public output.
No automatic retries are made on billable creation requests.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
import threading
import time
import uuid
from urllib import error, parse, request


MODEL = "fal-ai/kling-video/v2.1/standard/image-to-video"
QUEUE_ORIGIN = "https://queue.fal.run"
REQUEST_BASE = QUEUE_ORIGIN + "/fal-ai/kling-video/requests/"
MAX_IMAGE = 5 * 1024 * 1024
MAX_CONTENT = 80 * 1024 * 1024
MAX_ACTIVE = 4
MAX_RETAINED = 32
ACTIVE_STATES = {"submitting", "queued", "processing", "cancel_requested"}
_jobs: dict[str, dict] = {}
_request_ids: dict[str, str] = {}
_lock = threading.RLock()
_id_pattern = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_local_pattern = re.compile(r"[a-f0-9]{32}\Z")
_image_pattern = re.compile(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)\Z")


class VideoError(Exception):
    """A safe local HTTP error, without provider response bodies or headers."""

    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _key(key: str) -> str:
    if not isinstance(key, str) or not key.strip():
        raise VideoError(503, "Chưa cấu hình LUMA_VIDEO_KEY ở máy chủ để tạo video AI từ ảnh.")
    return key.strip()


def validate_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise VideoError(400, "Yêu cầu tạo video cần là đối tượng JSON.")
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2000:
        raise VideoError(400, "Mô tả chuyển động cần từ 1 đến 2.000 ký tự.")
    duration = payload.get("duration", 5)
    if isinstance(duration, bool) or duration not in (5, 10):
        raise VideoError(400, "Mỗi cảnh video AI có thời lượng 5 hoặc 10 giây.")
    image = payload.get("image")
    if not isinstance(image, str) or len(image) > MAX_IMAGE * 4 // 3 + 100:
        raise VideoError(400, "Ảnh đầu vào cần là PNG/JPEG tối đa 5 MB.")
    match = _image_pattern.fullmatch(image)
    if not match:
        raise VideoError(400, "Chỉ nhận dữ liệu ảnh PNG/JPEG, không nhận URL bên ngoài.")
    try:
        raw = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error):
        raise VideoError(400, "Dữ liệu ảnh không hợp lệ.") from None
    signature = b"\x89PNG\r\n\x1a\n" if match[1] == "png" else b"\xff\xd8\xff"
    if len(raw) > MAX_IMAGE or not raw.startswith(signature):
        raise VideoError(400, "Dữ liệu ảnh không đúng định dạng PNG/JPEG.")
    return {"prompt": prompt.strip(), "image": image, "duration": int(duration)}


def _safe_output_url(url: object) -> str:
    if not isinstance(url, str) or len(url) > 4096:
        raise VideoError(502, "Dịch vụ tạo video trả về địa chỉ kết quả không hợp lệ.")
    try:
        parsed = parse.urlsplit(url)
        host = (parsed.hostname or "").lower()
        valid = (
            parsed.scheme == "https"
            and (host == "fal.media" or host.endswith(".fal.media"))
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
            and bool(parsed.path)
            and not parsed.fragment
        )
    except ValueError:
        valid = False
    if not valid:
        raise VideoError(502, "Chỉ chấp nhận kết quả video HTTPS từ fal.media.")
    return url


class _QueueRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Keep queue authorization on the fixed endpoint; do not replay a POST.
        raise VideoError(502, "Dịch vụ tạo video yêu cầu chuyển hướng không được hỗ trợ.")


class _MediaRedirects(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _safe_output_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _open(req: request.Request, *, media: bool = False):
    # build_opener keeps inherited proxy discovery and the default verified TLS
    # context, including the cloud runtime's installed CA trust.
    opener = request.build_opener(_MediaRedirects() if media else _QueueRedirects())
    return opener.open(req, timeout=60 if media else 40)


def _translate_http(exc: error.HTTPError) -> VideoError:
    if exc.code in (401, 403):
        return VideoError(502, "Dịch vụ tạo video từ chối xác thực. Kiểm tra LUMA_VIDEO_KEY và quyền dùng model.")
    if exc.code == 429:
        return VideoError(429, "Dịch vụ tạo video đang giới hạn yêu cầu hoặc tài khoản hết hạn mức.")
    if exc.code in (400, 422):
        return VideoError(502, "Dịch vụ chưa chấp nhận ảnh hoặc ý tưởng. Hãy thử ảnh khác và mô tả ngắn hơn.")
    return VideoError(502, "Dịch vụ tạo video chưa xử lý được yêu cầu. Hãy thử lại sau.")


def _json_call(url: str, key: str, *, method: str = "GET", body: dict | None = None) -> dict:
    headers = {"Authorization": "Key " + _key(key), "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, method=method, headers=headers)
    try:
        with _open(req) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise VideoError(502, "Phản hồi tạo video quá lớn.")
            # Successful cancellation may return an empty 202/204 body.
            result = json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raise _translate_http(exc) from None
    except (error.URLError, TimeoutError, OSError):
        raise VideoError(502, "Không kết nối được dịch vụ tạo video. Kiểm tra proxy và quyền truy cập queue.fal.run.") from None
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise VideoError(502, "Dịch vụ tạo video trả về phản hồi không hợp lệ.") from None
    if not isinstance(result, dict):
        raise VideoError(502, "Dịch vụ tạo video trả về dữ liệu không hợp lệ.")
    return result


def _get(local_id: str) -> dict:
    if not isinstance(local_id, str) or not _local_pattern.fullmatch(local_id):
        raise VideoError(404, "Không tìm thấy tác vụ tạo video trong phiên máy chủ này.")
    with _lock:
        job = _jobs.get(local_id)
        if not job:
            raise VideoError(404, "Tác vụ đã hết phiên. Tệp video đã tải về vẫn có thể dùng trong dự án.")
        return dict(job)


def _public(job: dict) -> dict:
    result = {
        "id": job["id"], "status": job["status"], "provider": "fal.ai",
        "model": MODEL, "seconds": job["seconds"], "progress": job.get("progress", 0),
    }
    if job.get("message"):
        result["message"] = job["message"]
    if job["status"] == "completed":
        result["content_url"] = f"/api/video/jobs/{job['id']}/content"
    return result


def create_job(payload: object, key: str) -> dict:
    key = _key(key)
    clean = validate_payload(payload)
    client_id = payload.get("clientRequestId")
    if client_id is not None and (not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", client_id)):
        raise VideoError(400, "Mã yêu cầu cần là UUID hoặc chuỗi duy nhất hợp lệ.")
    fingerprint = hashlib.sha256(json.dumps(clean, sort_keys=True).encode()).hexdigest()
    local_id = uuid.uuid4().hex
    with _lock:
        if client_id and client_id in _request_ids:
            existing = _jobs[_request_ids[client_id]]
            if existing["fingerprint"] != fingerprint:
                raise VideoError(409, "Mã yêu cầu đã được dùng cho ảnh hoặc ý tưởng khác.")
            return _public(existing)
        if sum(job["status"] in ACTIVE_STATES for job in _jobs.values()) >= MAX_ACTIVE:
            raise VideoError(429, "Đang có 4 cảnh AI chờ tạo. Hãy đợi một tác vụ hoàn tất.")
        terminal = sorted((job for job in _jobs.values() if job["status"] not in ACTIVE_STATES), key=lambda job: job["created"])
        while len(_jobs) >= MAX_RETAINED and terminal:
            discarded = terminal.pop(0)
            _jobs.pop(discarded["id"], None)
            if discarded.get("client_id"):
                _request_ids.pop(discarded["client_id"], None)
        _jobs[local_id] = {"id": local_id, "status": "submitting", "seconds": clean["duration"], "created": time.time(), "progress": 0, "client_id": client_id, "fingerprint": fingerprint}
        if client_id:
            _request_ids[client_id] = local_id
    try:
        result = _json_call(QUEUE_ORIGIN + "/" + MODEL, key, method="POST", body={
            "prompt": clean["prompt"], "image_url": clean["image"], "duration": str(clean["duration"]),
        })
        provider_id = result.get("request_id")
        if not isinstance(provider_id, str) or not _id_pattern.fullmatch(provider_id):
            raise VideoError(502, "Dịch vụ không trả về mã tác vụ hợp lệ. Không tự gửi lại để tránh tạo trùng.")
        status = "processing" if result.get("status") == "IN_PROGRESS" else "queued"
        with _lock:
            _jobs[local_id].update(provider_id=provider_id, status=status)
            return _public(_jobs[local_id])
    except Exception:
        with _lock:
            # A timeout may happen after a paid submission was accepted. Retain
            # the idempotency token and never repeat that request automatically.
            _jobs[local_id].update(status="failed", message="Không xác nhận được yêu cầu tạo cảnh. Không tự gửi lại để tránh tạo trùng; kiểm tra tác vụ trên tài khoản fal.ai.")
        raise


def get_job(local_id: str, key: str) -> dict:
    job = _get(local_id)
    if job["status"] not in ACTIVE_STATES or job["status"] == "submitting":
        return _public(job)
    result = _json_call(REQUEST_BASE + job["provider_id"] + "/status", key)
    state = result.get("status")
    update = {}
    if state == "IN_QUEUE":
        update["status"] = "cancel_requested" if job["status"] == "cancel_requested" else "queued"
    elif state == "IN_PROGRESS":
        update["status"] = "cancel_requested" if job["status"] == "cancel_requested" else "processing"
    elif state == "COMPLETED":
        output = _json_call(REQUEST_BASE + job["provider_id"], key)
        video = output.get("video")
        url = _safe_output_url(video.get("url") if isinstance(video, dict) else None)
        update.update(status="completed", video_url=url, progress=100)
    elif state in {"FAILED", "ERROR"}:
        update.update(status="failed", message="Dịch vụ không tạo được cảnh video. Hãy thử ảnh hoặc ý tưởng khác.")
    elif state in {"CANCELLED", "CANCELED"}:
        update.update(status="cancelled", message="Dịch vụ đã xác nhận hủy tác vụ.")
    else:
        raise VideoError(502, "Dịch vụ trả về trạng thái tác vụ không được hỗ trợ.")
    progress = result.get("progress")
    if isinstance(progress, (int, float)) and not isinstance(progress, bool) and math.isfinite(progress):
        update["progress"] = max(0, min(100, round(progress)))
    with _lock:
        stored = _jobs.get(local_id)
        if not stored:
            raise VideoError(404, "Tác vụ đã hết phiên.")
        stored.update(update)
        return _public(stored)


def cancel_job(local_id: str, key: str) -> dict:
    job = _get(local_id)
    if job["status"] not in ACTIVE_STATES:
        return _public(job)
    if job["status"] == "submitting":
        raise VideoError(409, "Tác vụ đang được gửi. Hãy đợi nhận mã rồi yêu cầu hủy.")
    _json_call(REQUEST_BASE + job["provider_id"] + "/cancel", key, method="PUT")
    # Acknowledged cancellation is not proof an already-running paid job stopped.
    with _lock:
        _jobs[local_id].update(status="cancel_requested", message="Đã gửi yêu cầu hủy; cảnh đang chạy có thể vẫn hoàn tất và phát sinh phí.")
        return _public(_jobs[local_id])


def get_content(local_id: str, key: str) -> tuple[bytes, str]:
    job = _get(local_id)
    if job["status"] != "completed":
        raise VideoError(409, "Cảnh AI chưa hoàn tất để tải về.")
    url = _safe_output_url(job.get("video_url"))
    # A public CDN download must never receive the queue authorization header.
    req = request.Request(url, headers={"Accept": "video/mp4,video/webm"})
    try:
        with _open(req, media=True) as response:
            content_length = response.headers.get("Content-Length")
            if content_length:
                try:
                    if int(content_length) > MAX_CONTENT:
                        raise VideoError(502, "Cảnh AI vượt giới hạn tải 80 MB.")
                except ValueError:
                    raise VideoError(502, "Kích thước video từ dịch vụ không hợp lệ.") from None
            body = response.read(MAX_CONTENT + 1)
    except error.HTTPError:
        raise VideoError(502, "Không tải được cảnh AI từ máy chủ kết quả. Thử tải lại tác vụ này.") from None
    except (error.URLError, TimeoutError, OSError):
        raise VideoError(502, "Kết nối tải video bị gián đoạn. Kiểm tra truy cập fal.media rồi thử lại.") from None
    if len(body) > MAX_CONTENT:
        raise VideoError(502, "Cảnh AI vượt giới hạn tải 80 MB.")
    if len(body) >= 12 and body[4:8] == b"ftyp":
        return body, "video/mp4"
    if body.startswith(b"\x1aE\xdf\xa3"):
        return body, "video/webm"
    raise VideoError(502, "Kết quả tải về không phải tệp video MP4/WebM hợp lệ.")
