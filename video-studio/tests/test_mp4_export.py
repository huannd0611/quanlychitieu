"""MP4 conversion is exercised against real generated media, with no network."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import mp4_export as export


class MP4ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ffmpeg = shutil.which("ffmpeg")
        cls.ffprobe = shutil.which("ffprobe")
        cls.webm = None
        if cls.ffmpeg and cls.ffprobe:
            # Stream to stdout so the WebM lacks seekable duration metadata, as
            # with browser MediaRecorder, while containing real video + audio.
            result = subprocess.run([
                cls.ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x240:rate=15",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "1",
                "-c:v", "libvpx-vp9", "-c:a", "libopus", "-f", "webm", "pipe:1",
            ], capture_output=True, timeout=30, check=True)
            cls.webm = result.stdout

    def assert_error(self, code, fn, *args):
        with self.assertRaises(export.ExportError) as caught:
            fn(*args)
        self.assertEqual(caught.exception.status_code, code)
        self.assertNotIn("/tmp/", str(caught.exception))
        self.assertNotIn("private subprocess stderr", str(caught.exception))

    def test_real_streaming_webm_converts_to_h264_aac_and_decodes(self):
        if not self.webm:
            self.skipTest("FFmpeg/FFprobe unavailable")
        data = export.transcode_webm(self.webm)
        self.assertEqual(data[4:8], b"ftyp")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "actual.mp4"
            path.write_bytes(data)
            probe = subprocess.run([self.ffprobe, "-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height:format=duration", "-of", "json", str(path)], capture_output=True, check=True, timeout=20)
            info = json.loads(probe.stdout)
            video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
            audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
            self.assertEqual(video["codec_name"], "h264")
            self.assertEqual((video["width"], video["height"]), (160, 240))
            self.assertEqual(audio["codec_name"], "aac")
            self.assertTrue(.9 <= float(info["format"]["duration"]) <= 1.2)
            # Successful demuxing alone does not establish decodable output.
            subprocess.run([self.ffmpeg, "-v", "error", "-i", str(path), "-f", "null", "-"], capture_output=True, check=True, timeout=20)
            self.assertLess(data.find(b"moov"), data.find(b"mdat"), "MP4 should be suitable for progressive playback")

    def test_real_corrupt_webm_rejected_without_exposing_ffmpeg_errors(self):
        if not self.ffmpeg or not self.ffprobe:
            self.skipTest("FFmpeg/FFprobe unavailable")
        self.assert_error(422, export.transcode_webm, b"\x1aE\xdf\xa3invalid truncated media")

    def test_wrong_type_magic_or_size_rejected_before_subprocess(self):
        with patch.object(export.subprocess, "run") as run:
            for data in [None, "webm", b"", b"not media", b"\x00\x00\x00\x18ftypisom"]:
                self.assert_error(415, export.transcode_webm, data)
            with patch.object(export, "MAX_INPUT", 8):
                self.assert_error(413, export.transcode_webm, b"\x1aE\xdf\xa3" + b"a" * 10)
            self.assertFalse(run.called)

    def test_missing_tools_are_actionable(self):
        with patch.object(export.shutil, "which", return_value=None):
            self.assert_error(503, export.transcode_webm, b"\x1aE\xdf\xa3mock")

    def test_timeout_and_subprocess_errors_are_sanitized(self):
        with patch.object(export.subprocess, "run", side_effect=subprocess.TimeoutExpired(["/tmp/private"], 180, stderr=b"private subprocess stderr")):
            self.assert_error(504, export._run, ["ffmpeg"], 180)
        with patch.object(export.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"private subprocess stderr")):
            self.assert_error(422, export._run, ["ffmpeg"], 180)

    def test_actual_packet_duration_limit_rejects_without_silent_trimming(self):
        metadata = subprocess.CompletedProcess([], 0, json.dumps({"streams":[{"codec_type":"video", "width":720, "height":1280}]}).encode(), b"")
        packets = subprocess.CompletedProcess([], 0, b"0.000,0.000,0.033\n181.000,181.000,0.033\n", b"")
        with patch.object(export.subprocess, "run", side_effect=[metadata, packets]):
            self.assert_error(422, export._probe, "ffprobe", Path("/tmp/input.webm"))


if __name__ == "__main__":
    unittest.main()
