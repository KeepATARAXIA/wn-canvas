import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("canvas_h3_reference", ROOT / "extras/video-suite/ComfyUI/comfy_extras/canvas_h3_reference.py")
media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(media)


class ReferencePreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="canvas-h3-reference-test-")
        cls.folder = Path(cls.temp.name)
        for fps in (30, 60):
            subprocess.run([str(media.TOOLS / "ffmpeg.exe"), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate={fps}",
                            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "5", "-c:v", "libx264", "-preset", "ultrafast",
                            "-pix_fmt", "yuv420p", "-c:a", "aac", str(cls.folder / f"fps{fps}.mp4")], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        subprocess.run([str(media.TOOLS / "ffmpeg.exe"), "-v", "error", "-f", "lavfi", "-i", "color=size=64x64:rate=24", "-t", "60", "-c:v", "libx264",
                        "-preset", "ultrafast", str(cls.folder / "long.mp4")], check=True, creationflags=subprocess.CREATE_NO_WINDOW)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def prepare(self, file, names=None, check=lambda: None):
        directory = tempfile.TemporaryDirectory(dir=self.folder)
        self.addCleanup(directory.cleanup)
        return media.prepare_reference(file, json.dumps(names or [file]), self.folder, 480, 480, 124, directory.name, check)

    def metadata(self, file):
        result = subprocess.run([str(media.TOOLS / "ffprobe.exe"), "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(file)],
                                capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        return json.loads(result.stdout)

    def test_30_and_60_fps_have_same_timebase_frame_count_and_bounded_dimensions(self):
        for fps in (30, 60):
            with self.subTest(fps=fps):
                file = self.prepare(f"fps{fps}.mp4")
                meta = self.metadata(file)
                video = next(s for s in meta["streams"] if s["codec_type"] == "video")
                audio = next(s for s in meta["streams"] if s["codec_type"] == "audio")
                self.assertEqual(video["r_frame_rate"], "24/1")
                self.assertEqual(int(video["nb_read_frames"]), 124)
                self.assertLessEqual(video["width"] * video["height"], 480 * 480)
                self.assertEqual((audio["sample_rate"], audio["channels"]), ("32000", 2))
                self.assertAlmostEqual(float(meta["format"]["duration"]), 124 / 24, delta=0.05)
                # Decode the complete soundtrack and verify audio/video share the same bounded duration.
                pcm = subprocess.run([str(media.TOOLS / "ffmpeg.exe"), "-v", "error", "-i", str(file), "-vn", "-f", "s16le", "-"],
                                     capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW).stdout
                self.assertAlmostEqual(len(pcm) / (32000 * 2 * 2), 124 / 24, delta=0.05)

    def test_long_reference_rejected_before_conversion(self):
        original = media.run_media_command
        commands = []
        def record(command, *args, **kwargs):
            commands.append(command)
            return original(command, *args, **kwargs)
        with patch.object(media, "run_media_command", side_effect=record):
            with self.assertRaisesRegex(ValueError, "时长.*2–15"):
                self.prepare("long.mp4")
        self.assertEqual(len(commands), 1)
        self.assertTrue(commands[0][0].endswith("ffprobe.exe"))

    def test_total_reference_duration_is_checked_from_actual_files(self):
        with patch.object(media, "probe_video", return_value={"duration": 8, "width": 640, "height": 360}):
            with self.assertRaisesRegex(ValueError, "总时长"):
                self.prepare("fps30.mp4", ["fps30.mp4", "fps60.mp4"])

    def test_path_escape_and_bad_file_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "输入目录"):
            self.prepare("../outside.mp4")
        (self.folder / "bad.mp4").write_bytes(b"broken")
        with self.assertRaisesRegex(ValueError, "无法读取"):
            self.prepare("bad.mp4")

    def test_cancellation_reaps_only_the_preprocessing_child(self):
        children = []
        popen = subprocess.Popen
        def capture(*args, **kwargs):
            child = popen(*args, **kwargs)
            children.append(child)
            return child
        checks = 0
        def cancel():
            nonlocal checks
            checks += 1
            if checks >= 3:
                raise InterruptedError("cancelled")
        with patch.object(media.subprocess, "Popen", side_effect=capture):
            with self.assertRaises(InterruptedError):
                media.run_media_command([str(media.TOOLS / "ffmpeg.exe"), "-v", "error", "-re", "-f", "lavfi", "-i", "color=size=64x64", "-t", "30", "-f", "null", "-"], cancel)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())

    def test_timeout_reaps_child(self):
        with self.assertRaisesRegex(ValueError, "超时"):
            media.run_media_command([str(media.TOOLS / "ffmpeg.exe"), "-v", "error", "-re", "-f", "lavfi", "-i", "color=size=64x64", "-t", "30", "-f", "null", "-"], lambda: None, timeout=0)


if __name__ == "__main__":
    unittest.main()
