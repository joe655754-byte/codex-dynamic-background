"""Run with: python -m unittest discover -s tests -p test_video.py -v

Real encoding tests additionally need FFMPEG and FFPROBE environment variables
(absolute executable paths), or ffmpeg and ffprobe on PATH. Fixtures are generated
locally; no copyrighted media or network requests are used.
"""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "codex-dynamic-background" / "scripts" / "prepare_video.py"
spec = importlib.util.spec_from_file_location("prepare_video", SCRIPT)
prepare = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(prepare)
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
FFPROBE = os.environ.get("FFPROBE") or shutil.which("ffprobe")


class PreparationUnitTests(unittest.TestCase):
    def test_duration_limit_and_invalid_values(self):
        prepare.enforce_duration(30.0)
        for value in (30.002, 31.0, 0, -1, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(prepare.PreparationError):
                prepare.enforce_duration(value)

    def test_missing_program_does_not_download(self):
        with patch.object(prepare.shutil, "which", return_value=None):
            with self.assertRaisesRegex(prepare.PreparationError, "Nothing was downloaded"):
                prepare.find_program("ffprobe", None)

    def test_force_refuses_unowned_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "unrelated"
            target.mkdir()
            sentinel = target / "notes.txt"
            sentinel.write_text("Do not change", encoding="utf-8")
            with self.assertRaisesRegex(prepare.PreparationError, "only replaces a bundle"):
                prepare.validate_destination(target, root / "source.mp4", True)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "Do not change")

    def test_output_cannot_contain_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(prepare.PreparationError, "must not contain"):
                prepare.validate_destination(root, root / "source.mp4", False)

    def test_interrupted_publish_restores_previous_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output, stage = root / "output", root / "stage"
            output.mkdir()
            stage.mkdir()
            for name in prepare.BUNDLE_FILES:
                (output / name).write_bytes(b"old-" + name.encode())
                (stage / name).write_bytes(b"new-" + name.encode())
            unrelated = output / "keep.txt"
            unrelated.write_bytes(b"untouched")
            original_replace = Path.replace

            def fail_mid_commit(path, target):
                if path == stage / "poster.jpg":
                    raise OSError("simulated disk error")
                return original_replace(path, target)

            with patch.object(Path, "replace", fail_mid_commit):
                with self.assertRaisesRegex(OSError, "simulated disk error"):
                    prepare.publish_bundle(stage, output)
            for name in prepare.BUNDLE_FILES:
                self.assertEqual((output / name).read_bytes(), b"old-" + name.encode())
            self.assertEqual(unrelated.read_bytes(), b"untouched")


@unittest.skipUnless(FFMPEG and FFPROBE, "Install ffmpeg and ffprobe, or set FFMPEG and FFPROBE")
class RealVideoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="codex-video-tests-")
        cls.root = Path(cls.temp.name)
        cls.short = cls.root / "sample [1] 中文 空格 $ %.mp4"
        cls.long = cls.root / "31-seconds.mp4"
        cls.fast = cls.root / "120fps.mp4"
        cls.variable = cls.root / "vfr-with-offset.mp4"
        cls.ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x120:rate=24:duration=1.25",
                   "-f", "lavfi", "-i", "sine=frequency=440:duration=1.25",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(cls.short))
        cls.ffmpeg("-f", "lavfi", "-i", "testsrc2=size=32x24:rate=1:duration=31",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", str(cls.long))
        cls.ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=120:duration=0.5",
                   "-c:v", "libx264", "-pix_fmt", "yuv420p", str(cls.fast))
        cls.ffmpeg("-f", "lavfi", "-i", "testsrc2=size=160x90:rate=24:duration=1.25",
                   "-vf", "select='not(mod(n,2))+not(mod(n,5))'", "-fps_mode", "vfr",
                   "-output_ts_offset", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(cls.variable))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    @classmethod
    def ffmpeg(cls, *arguments):
        subprocess.run([str(FFMPEG), "-hide_banner", "-nostdin", "-v", "error", "-y", *arguments],
                       check=True, capture_output=True)

    def cli(self, source, output, *arguments):
        return subprocess.run([sys.executable, str(SCRIPT), str(source), "--output", str(output),
                               "--ffmpeg", str(FFMPEG), "--ffprobe", str(FFPROBE), *arguments],
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    def test_complete_video_audio_removed_and_special_paths(self):
        output = self.root / "bundle 中文 [1]"
        original = self.short.read_bytes()
        result = self.cli(self.short, output, "--fps", "60")
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["fps"], 24)
        self.assertEqual(metadata["decoded_frames"], 30)
        self.assertAlmostEqual(metadata["duration_seconds"], 1.25, places=4)
        self.assertFalse(metadata["audio"])
        self.assertEqual(metadata["validation"]["full_decode"], "passed")
        self.assertEqual(self.short.read_bytes(), original)
        self.assertNotIn(str(self.short), (output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(set(prepare.BUNDLE_FILES), {path.name for path in output.iterdir()})
        _, stream, streams = prepare.inspect_video(Path(FFPROBE), output / "wallpaper.mp4")
        self.assertEqual(stream["codec_name"], "h264")
        self.assertFalse(any(s.get("codec_type") == "audio" for s in streams))
        prepare.fully_decode(Path(FFMPEG), output / "wallpaper.mp4", int(stream["index"]))
        frames = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output / "wallpaper.mp4"),
                                 "-map", "0:v:0", "-f", "framemd5", "-"],
                                check=True, capture_output=True, text=True).stdout
        hashes = [line.rsplit(",", 1)[-1].strip() for line in frames.splitlines()
                  if line.strip() and not line.startswith("#")]
        self.assertEqual(len(hashes), 30)
        self.assertGreater(len(set(hashes)), 20, "The dynamic source must not become a repeated still image")
        pixels = subprocess.run([str(FFMPEG), "-v", "error", "-i", str(output / "wallpaper.mp4"),
                                 "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                                check=True, capture_output=True).stdout
        left_edge = (540 * 1920 + 4) * 3
        self.assertLessEqual(max(pixels[left_edge:left_edge + 3]), 5,
                             "contain must letterbox the 4:3 fixture instead of stretching or cropping it")
        before = {name: (output / name).read_bytes() for name in prepare.BUNDLE_FILES}
        refused = self.cli(self.short, output)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("already exists", refused.stderr)
        self.assertEqual(before, {name: (output / name).read_bytes() for name in prepare.BUNDLE_FILES})
        self.assertEqual(self.cli(self.short, output, "--force").returncode, 0)

    def test_over_30_seconds_is_rejected_without_bundle(self):
        output = self.root / "rejected-bundle"
        result = self.cli(self.long, output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("choose a segment", result.stderr)
        self.assertFalse(output.exists())

    def test_high_fps_is_reduced_without_changing_duration(self):
        output = self.root / "fast-bundle"
        result = self.cli(self.fast, output)
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["fps"], 60)
        self.assertEqual(metadata["decoded_frames"], 30)
        self.assertAlmostEqual(metadata["duration_seconds"], .5, places=4)

    def test_variable_frame_rate_and_nonzero_start_keep_all_frames_and_spacing(self):
        output = self.root / "variable-bundle"
        result = self.cli(self.variable, output)
        self.assertEqual(result.returncode, 0, result.stderr)

        def timestamps(path):
            result = subprocess.run([str(FFPROBE), "-v", "error", "-select_streams", "v:0",
                                     "-show_frames", "-show_entries", "frame=best_effort_timestamp_time",
                                     "-of", "json", str(path)], capture_output=True, text=True, check=True)
            return [float(frame["best_effort_timestamp_time"]) for frame in json.loads(result.stdout)["frames"]]

        original, converted = timestamps(self.variable), timestamps(output / "wallpaper.mp4")
        self.assertGreaterEqual(original[0], 5)
        self.assertAlmostEqual(converted[0], 0, places=5)
        self.assertEqual(len(original), len(converted))
        for before, after in zip(original, converted):
            self.assertAlmostEqual(before - original[0], after, places=5)


if __name__ == "__main__":
    unittest.main()
