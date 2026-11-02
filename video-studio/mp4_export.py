"""Convert a bounded browser-recorded WebM to a portable H.264/AAC MP4."""
from __future__ import annotations

import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile


MAX_INPUT = 100 * 1024 * 1024
MAX_OUTPUT = 150 * 1024 * 1024
MAX_DURATION = 180


class ExportError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _run(command: list[str], timeout: int):
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise ExportError(504, "Chuyển đổi MP4 quá thời gian cho phép. Hãy giảm độ phân giải hoặc thời lượng video.") from None
    except (FileNotFoundError, PermissionError, OSError):
        raise ExportError(503, "Máy chủ chưa có quyền chạy FFmpeg/FFprobe. Bạn vẫn có thể xuất WebM.") from None
    if result.returncode:
        raise ExportError(422, "Không chuyển đổi được video WebM này. Hãy xuất lại từ trình biên tập và thử lần nữa.")
    return result


def _probe(ffprobe: str, source: Path) -> None:
    metadata = _run([
        ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
        "stream=codec_type,width,height", "-of", "json", str(source),
    ], 30)
    try:
        streams = json.loads(metadata.stdout).get("streams", [])
        video = next(stream for stream in streams if stream.get("codec_type") == "video")
        width, height = video["width"], video["height"]
        if not isinstance(width, int) or not isinstance(height, int) or width < 2 or height < 2 or max(width, height) > 4096 or width * height > 4096 * 2160:
            raise ValueError("unsupported dimensions")
    except (ValueError, KeyError, TypeError, StopIteration, AttributeError):
        raise ExportError(422, "Video cần có hình ảnh hợp lệ, tối đa độ phân giải 4K.") from None

    # MediaRecorder's streaming WebM often has no duration header. Inspect actual
    # packet timestamps instead of trusting an absent or forged format.duration.
    packets = _run([
        ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
        "packet=pts_time,dts_time,duration_time", "-of", "csv=p=0", str(source),
    ], 30)
    end, start, has_timestamp = 0.0, 0.0, False
    try:
        for row in packets.stdout.decode("ascii").splitlines():
            fields = row.split(",")
            if len(fields) < 2:
                continue
            stamps = []
            for field in fields[:2]:
                try:
                    value = float(field)
                    if math.isfinite(value):
                        stamps.append(value)
                except ValueError:
                    pass
            if not stamps:
                continue
            has_timestamp = True
            duration = 0.0
            if len(fields) >= 3:
                try:
                    candidate = float(fields[2])
                    duration = candidate if math.isfinite(candidate) and candidate >= 0 else 0.0
                except ValueError:
                    pass
            start = min(start, min(stamps))
            end = max(end, max(stamps) + duration)
            if end - start > MAX_DURATION + .1:
                raise ExportError(422, "Xuất MP4 hỗ trợ video tối đa 180 giây. Hãy rút ngắn bản dựng hoặc chọn WebM.")
        if not has_timestamp or end - start <= 0:
            raise ValueError("no valid timeline")
    except (UnicodeError, ValueError):
        raise ExportError(422, "Không xác định được thời lượng WebM. Hãy xuất lại từ trình biên tập.") from None


def transcode_webm(data: bytes) -> bytes:
    if not isinstance(data, bytes) or not data:
        raise ExportError(415, "Cần gửi tệp WebM được tạo từ trình biên tập.")
    if len(data) > MAX_INPUT:
        raise ExportError(413, "Tệp WebM vượt giới hạn chuyển đổi 100 MB.")
    if not data.startswith(b"\x1aE\xdf\xa3"):
        raise ExportError(415, "Định dạng đầu vào cần là WebM.")
    ffmpeg, ffprobe = shutil.which("ffmpeg"), shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        raise ExportError(503, "Máy chủ chưa cài FFmpeg/FFprobe để xuất MP4. Bạn vẫn có thể xuất WebM.")
    try:
        with tempfile.TemporaryDirectory(prefix="luma-mp4-") as directory:
            source, target = Path(directory) / "input.webm", Path(directory) / "output.mp4"
            source.write_bytes(data)
            _probe(ffprobe, source)
            _run([
                ffmpeg, "-nostdin", "-v", "error", "-filter_threads", "1", "-protocol_whitelist", "file,pipe",
                "-i", str(source), "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-pix_fmt", "yuv420p", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-c:a", "aac", "-b:a", "160k", "-threads", "2", "-movflags", "+faststart", str(target),
            ], 180)
            if not target.is_file() or not 12 <= target.stat().st_size <= MAX_OUTPUT:
                raise ExportError(502, "Bản xuất MP4 không hợp lệ hoặc vượt giới hạn dung lượng. Hãy chọn độ phân giải thấp hơn.")
            result = target.read_bytes()
            if result[4:8] != b"ftyp":
                raise ExportError(502, "Máy chủ chưa tạo được tệp MP4 hợp lệ.")
            return result
    except ExportError:
        raise
    except OSError:
        raise ExportError(503, "Máy chủ không đủ dung lượng hoặc quyền ghi để xuất MP4. Hãy chọn WebM hoặc thử lại.") from None
