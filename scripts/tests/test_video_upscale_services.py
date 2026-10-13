import importlib.util
import io
import json
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SeedServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = load('seed_test_service', 'scripts/seedvr2-service.py')
        self.service.WORK = Path(self.temp.name)
        self.service.models_ready = lambda: True
        self.service.ensure_ffmpeg = lambda: ROOT / 'extras/video-suite/LosslessCut/resources/ffmpeg.exe'
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self.service.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, path, data=None):
        try:
            with urlopen(Request(self.base + path, data=data), timeout=10) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_bad_video_has_friendly_error_and_same_id_does_not_resubmit(self):
        job_id = 'a' * 32
        status, response = self.request('/jobs?id=' + job_id, b'broken video bytes')
        self.assertEqual(status, 400)
        self.assertIn('无法解码', response['error'])
        status, job = self.request('/jobs/' + job_id)
        self.assertEqual(status, 200)
        self.assertEqual(job['status'], 'error')
        self.assertNotIn('input', job)
        status, response = self.request('/jobs?id=' + job_id, b'other bytes')
        self.assertEqual((status, response['id']), (202, job_id))

    def test_cancel_is_scoped_and_jobs_reload_from_disk(self):
        first_id, second_id = 'b' * 32, 'c' * 32
        for job_id in (first_id, second_id):
            folder = self.service.WORK / job_id
            folder.mkdir()
            job = {'id': job_id, 'status': 'queued', 'input': str(folder / 'input.mp4'), 'result': str(folder / 'result.mp4')}
            self.service.JOBS[job_id] = job
            self.service.save(job)
        status, cancelled = self.request('/jobs/' + first_id + '/cancel', b'')
        self.assertEqual(status, 200)
        self.assertEqual(cancelled['status'], 'cancelling')
        self.assertTrue(self.service.JOBS[first_id]['cancelRequested'])
        self.assertEqual(self.service.JOBS[second_id]['status'], 'queued')
        self.service.JOBS.clear()
        self.service.load_jobs()
        self.assertEqual(self.service.JOBS[first_id]['status'], 'error')
        self.assertEqual(self.service.JOBS[second_id]['status'], 'error')
        self.assertIn('服务曾中断', self.service.JOBS[first_id]['error'])

    def test_cancel_before_upload_reserves_id_and_blocks_late_post(self):
        job_id = '1' * 32
        status, cancelled = self.request('/jobs/' + job_id + '/cancel', b'')
        self.assertEqual((status, cancelled['status']), (200, 'cancelled'))
        status, response = self.request('/jobs?id=' + job_id, b'late upload')
        self.assertEqual((status, response['id']), (202, job_id))
        self.assertEqual(self.service.JOBS[job_id]['status'], 'cancelled')
        self.assertFalse((self.service.WORK / job_id / 'input.mp4').exists())

    def test_completed_result_survives_reload(self):
        job_id = 'd' * 32
        folder = self.service.WORK / job_id
        folder.mkdir()
        result = folder / 'result.mp4'
        result.write_bytes(b'completed result')
        job = {'id': job_id, 'status': 'complete', 'input': str(folder / 'input.mp4'), 'result': str(result)}
        self.service.save(job)
        self.service.load_jobs()
        with urlopen(self.base + '/jobs/' + job_id + '/result') as response:
            self.assertEqual(response.read(), b'completed result')

    def test_legacy_completed_result_is_recovered(self):
        job_id = 'f' * 32
        folder = self.service.WORK / job_id
        folder.mkdir()
        subprocess.run([str(self.service.ensure_ffmpeg()), '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=16x16:r=1:d=1', '-c:v', 'libx264', str(folder / 'result.mp4')], check=True, capture_output=True)
        self.service.load_jobs()
        self.assertEqual(self.service.JOBS[job_id]['status'], 'complete')
        self.assertTrue((folder / 'job.json').exists())

    def test_quality_settings_reach_inference_without_silent_clamping(self):
        settings = self.service.quality_settings({'resolution': ['1440'], 'batchSize': ['9'], 'temporalOverlap': ['4'], 'colorCorrection': ['wavelet'], 'seed': ['123']})
        command = self.service.inference_command({'input': 'source.mp4', **settings}, 'result.mp4')
        for option, value in {'--resolution': '1440', '--batch_size': '9', '--temporal_overlap': '4', '--color_correction': 'wavelet', '--seed': '123'}.items():
            self.assertEqual(command[command.index(option) + 1], value)
        self.assertIn('--uniform_batch_size', command)
        self.assertEqual(self.service.quality_settings({})['batchSize'], 5)

    def test_invalid_quality_settings_are_rejected_before_reserving_a_job(self):
        for query in ('batchSize=8', 'temporalOverlap=9', 'resolution=10000', 'seed=-1', 'seed=1.5', 'colorCorrection=unknown'):
            status, response = self.request('/jobs?id=' + '2' * 32 + '&' + query, b'video')
            self.assertEqual(status, 400)
            self.assertTrue(response['error'])
        self.assertEqual(self.service.JOBS, {})

    def test_loading_percentage_never_becomes_video_progress(self):
        self.assertIsNone(self.service.inference_stage('Loading weights: 100%'))
        self.assertEqual(self.service.inference_stage('Phase 2: DiT upscaling'), '正在修复视频细节')
        self.assertIsNone(self.service.inference_stage('Phase 2: DiT upscaling complete'))

    def test_mux_keeps_all_video_frames_with_short_audio_or_no_audio(self):
        service = self.service
        ffmpeg = str(service.ensure_ffmpeg())
        class IdleServices:
            def open(self, *_args, **_kwargs):
                return io.BytesIO(b'{"queue_running":[],"queue_pending":[],"busy":false,"running":false}')
        for audio in (False, True):
            with self.subTest(audio=audio):
                job_id = ('3' if audio else '4') * 32
                folder = service.WORK / job_id
                folder.mkdir()
                source, result = folder / 'input.mp4', folder / 'result.mp4'
                command = [ffmpeg, '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=32x32:r=12:d=1']
                if audio:
                    command += ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'aac']
                subprocess.run(command + ['-c:v', 'libx264', str(source)], check=True, capture_output=True)
                job = {'id': job_id, 'status': 'queued', 'input': str(source), 'result': str(result), 'resolution': 1080}
                service.JOBS[job_id] = job
                with patch.object(service, 'build_opener', return_value=IdleServices()), patch.object(service, 'inference_command', side_effect=lambda job, output: [ffmpeg, '-y', '-i', job['input'], '-an', '-c:v', 'copy', str(output)]):
                    service.run_job(job)
                self.assertEqual(job['status'], 'complete', job.get('diagnostic'))
                probe = ROOT / 'extras/video-suite/LosslessCut/resources/ffprobe.exe'
                media = json.loads(subprocess.check_output([str(probe), '-v', 'error', '-show_streams', '-of', 'json', str(result)]))
                video = next(stream for stream in media['streams'] if stream['codec_type'] == 'video')
                self.assertEqual(int(video['nb_frames']), 12)
                self.assertAlmostEqual(float(video['duration']), 1, places=2)
                tracks = [stream for stream in media['streams'] if stream['codec_type'] == 'audio']
                self.assertEqual(bool(tracks), audio)
                if audio:
                    self.assertAlmostEqual(float(tracks[0]['duration']), 1, delta=0.05)


class VideoServiceTests(unittest.TestCase):
    def test_bad_input_is_actionable_and_validated_before_job_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            service = load('video_test_service', 'scripts/canvas-video-service.py')
            service.ASSETS = Path(directory)
            asset_id = 'e' * 32
            (service.ASSETS / (asset_id + '.mp4')).write_bytes(b'broken video bytes')
            with self.assertRaisesRegex(ValueError, '视频无法读取'):
                service.validate({'operation': 'upscale', 'projectId': 'test', 'source': asset_id})

    def test_successful_legacy_video2x_job_hides_exit_notice(self):
        service = load('video_public_test', 'scripts/canvas-video-service.py')
        job = {'status': 'complete', 'notice': 'Video2X 保存后退出异常，但输出已通过完整解码与时长校验。', 'video2xExitCode': 1}
        public = service.Handler.__new__(service.Handler).public(job)
        self.assertNotIn('notice', public)
        self.assertNotIn('video2xExitCode', public)


if __name__ == '__main__':
    unittest.main()
