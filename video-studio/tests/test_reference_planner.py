"""Reference-plan validation and provider contract tests; never calls a paid API."""

import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib import error


SPEC = importlib.util.spec_from_file_location("reference_planner", Path(__file__).resolve().parents[1] / "reference_planner.py")
planner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(planner)
PNG = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nlocal-test-image").decode()


def request_data():
    return {
        "mode": "edit", "prompt": 'Một video Reels bình yên, "Đi thật chậm".',
        "reference": {"duration": 6, "width": 720, "height": 1280, "ratio": "9:16", "cuts": [0, 2, 4, 6],
                      "shotDurations": [2, 2, 2], "tempo": "medium", "brightness": .6, "saturation": .4,
                      "frames": [{"time": 1, "thumbnail": PNG}, {"time": 4.5, "thumbnail": PNG}]},
        "assets": [{"id": "photo-1", "name": "My image", "mediaType": "image", "duration": 30, "frames": [{"time": 0, "thumbnail": PNG}]},
                   {"id": "video-1", "name": "My video", "mediaType": "video", "duration": 8, "frames": [{"time": 1, "thumbnail": PNG}]}],
    }


def scene(asset="photo-1", **updates):
    result = {"assetId": asset, "duration": 2, "start": 0, "speed": 1, "caption": "Một ngày đẹp trời", "position": "bottom",
              "color": "#ffffff", "motion": "push", "transition": "fade", "generationPrompt": ""}
    result.update(updates)
    return result


def plan_data():
    return {"title": "Một ngày đẹp trời", "ratio": "9:16", "style": "natural", "transition": "fade", "summary": "Theo nhịp mẫu tham chiếu.",
            "scenes": [scene(), scene("video-1", start=1, motion="none"), scene()]}


class ReferencePlannerTests(unittest.TestCase):
    def test_temporal_reference_and_source_frames_sent_to_real_api_contract(self):
        data = planner.validate_request(request_data())
        response = {"status": "completed", "output": [{"content": [{"type": "output_text", "text": json.dumps(plan_data())}]}]}
        with patch.object(planner.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())) as upstream:
            result = planner.create_plan(data, "private-test-key")
        self.assertEqual(result, plan_data())
        request = upstream.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        body = json.loads(request.data)
        content = body["input"][0]["content"]
        self.assertEqual(sum(part["type"] == "input_image" for part in content), 4)
        self.assertTrue(any("4.50" in part.get("text", "") for part in content))
        self.assertTrue(any("TƯ LIỆU NGUỒN video-1" in part.get("text", "") for part in content))
        self.assertEqual(body["text"]["format"]["type"], "json_schema")
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertFalse(body["store"])
        self.assertNotIn("private-test-key", json.dumps(result))

    def test_no_reference_generation_needs_only_image_and_idea(self):
        raw = request_data()
        raw.update(mode="generate", reference=None, ratio="16:9")
        raw["assets"] = raw["assets"][:1]
        data = planner.validate_request(raw)
        self.assertEqual(data["maxScenes"], 1)
        self.assertFalse(data["reference"]["provided"])
        result = planner.local_plan(data)
        self.assertEqual(result["ratio"], "16:9")
        self.assertEqual(len(result["scenes"]), 1)
        self.assertEqual(result["scenes"][0]["duration"], 5)
        self.assertIn("subject movement", result["scenes"][0]["generationPrompt"])
        self.assertIn("không có video tham chiếu", result["summary"])

    def test_local_rules_match_reference_timing_and_allow_repeated_assets(self):
        data = planner.validate_request(request_data())
        result = planner.local_plan(data)
        self.assertEqual([scene["duration"] for scene in result["scenes"]], [2, 2, 2])
        self.assertEqual([scene["assetId"] for scene in result["scenes"]], ["photo-1", "video-1", "photo-1"])
        self.assertAlmostEqual(sum(scene["duration"] for scene in result["scenes"]), 6)
        self.assertTrue(all(scene["caption"] == "Đi thật chậm" for scene in result["scenes"]))
        self.assertIn("Không có phân tích ngữ nghĩa bằng AI", result["summary"])

    def test_input_rejects_bad_timecodes_urls_duplicates_and_nonimage_generation(self):
        mutations = [
            lambda d: d["reference"].update(cuts=[0, 4, 2, 6]),
            lambda d: d["reference"].update(shotDurations=[1, 2, 3]),
            lambda d: d["reference"].update(duration=float("nan")),
            lambda d: d["reference"].update(brightness=255),
            lambda d: d["reference"]["frames"][0].update(thumbnail="https://internal.invalid/image.png"),
            lambda d: d["assets"][1].update(id="photo-1"),
            lambda d: d.update(mode="generate"),
            lambda d: d.update(maxScenes=True),
            lambda d: d.update(prompt=" " * 1600),
        ]
        for mutate in mutations:
            raw = request_data(); mutate(raw)
            with self.subTest(raw=raw), self.assertRaises(planner.PlannerError) as caught:
                planner.validate_request(raw)
            self.assertEqual(caught.exception.code, 400)

    def test_atomic_plan_validation_blocks_unknown_assets_unsafe_trim_and_bad_styles(self):
        data = planner.validate_request(request_data())
        mutations = [
            lambda p: p["scenes"][0].update(assetId="invented"),
            lambda p: p["scenes"][1].update(start=7, duration=2),
            lambda p: p["scenes"][1].update(start=4, duration=3, speed=2),
            lambda p: p["scenes"][0].update(start=1),
            lambda p: p["scenes"][0].update(color="url(https://example.invalid)"),
            lambda p: p["scenes"][0].update(speed=float("inf")),
            lambda p: p["scenes"][0].update(position="arbitrary-css"),
            lambda p: p.update(style=[]),
        ]
        for mutate in mutations:
            plan = plan_data(); mutate(plan)
            with self.subTest(plan=plan), self.assertRaises(planner.PlannerError) as caught:
                planner.validate_plan(plan, data)
            self.assertEqual(caught.exception.code, 502)

    def test_generation_scene_budget_duration_and_prompt_required(self):
        raw = request_data(); raw.update(mode="generate", maxScenes=2)
        raw["assets"] = raw["assets"][:1]
        data = planner.validate_request(raw)
        plan = plan_data(); plan["scenes"] = [scene(duration=5, generationPrompt="Natural leaves sway gently in soft sunlight.")]
        self.assertEqual(planner.validate_plan(plan, data)["scenes"][0]["duration"], 5)
        for updates in [{"duration": 11}, {"duration": 8, "speed": 2}, {"generationPrompt": ""}]:
            invalid = copy.deepcopy(plan); invalid["scenes"][0].update(updates)
            with self.subTest(updates=updates), self.assertRaises(planner.PlannerError):
                planner.validate_plan(invalid, data)
        invalid = copy.deepcopy(plan); invalid["scenes"] *= 3
        with self.assertRaises(planner.PlannerError):
            planner.validate_plan(invalid, data)
        local = planner.local_plan(data)
        self.assertLessEqual(len(local["scenes"]), 2)
        self.assertTrue(all(scene["generationPrompt"] for scene in local["scenes"]))

    def test_provider_errors_do_not_expose_body_or_key_and_missing_key_does_not_call(self):
        data = planner.validate_request(request_data())
        with patch.object(planner.request, "urlopen") as upstream, self.assertRaises(planner.PlannerError) as caught:
            planner.create_plan(data, "")
        self.assertEqual(caught.exception.code, 503)
        upstream.assert_not_called()
        failure = error.HTTPError(planner.API_URL, 401, "Secret provider failure", {}, io.BytesIO(b"sensitive-body"))
        with patch.object(planner.request, "urlopen", side_effect=failure), self.assertRaises(planner.PlannerError) as caught:
            planner.create_plan(data, "never-return-this-key")
        self.assertNotIn("Secret", str(caught.exception))
        self.assertNotIn("sensitive", str(caught.exception))
        self.assertNotIn("never-return-this-key", str(caught.exception))

    def test_incomplete_or_malformed_provider_output_cannot_change_project(self):
        data = planner.validate_request(request_data())
        for response in [{"status": "incomplete", "output": []}, {"status": "completed", "output": {}}, {"status": "completed", "output": [{"content": [{"type": "output_text", "text": "not json"}]}]}]:
            with self.subTest(response=response), patch.object(planner.request, "urlopen", return_value=io.BytesIO(json.dumps(response).encode())), self.assertRaises(planner.PlannerError):
                planner.create_plan(data, "test-key")


if __name__ == "__main__":
    unittest.main()
