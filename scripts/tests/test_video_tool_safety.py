import importlib.util
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).resolve().parents[2]

def service():
    spec = importlib.util.spec_from_file_location('video_safety', ROOT / 'scripts/canvas-video-service.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class VideoToolSafetyTests(unittest.TestCase):
    def check_queue(self, qwen):
        app = service()
        calls = []
        def request(req, **kwargs):
            url = req.full_url if hasattr(req, 'full_url') else req
            calls.append(url)
            value = qwen if ':8189/' in url else {'busy': False, 'running': False}
            if isinstance(value, Exception):
                raise value
            return io.BytesIO(json.dumps(value).encode())
        with patch.object(app, 'api', return_value={'queue_running': [], 'queue_pending': []}), patch.object(app.OPENER, 'open', side_effect=request):
            app.gpu_idle()
        return calls

    def test_qwen_idle_checked(self):
        self.assertTrue(any(':8189/queue' in url for url in self.check_queue({'queue_running': [], 'queue_pending': []})))

    def test_qwen_active_or_pending_blocks(self):
        for key in ['queue_running', 'queue_pending']:
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, '千问'):
                self.check_queue({'queue_running': [], 'queue_pending': [], key: [[0, 'task']]})

    def test_qwen_unknown_state_blocks(self):
        for value in [{}, {'queue_running': [], 'queue_pending': 'bad'}, URLError(TimeoutError('timed out')), HTTPError('http://localhost', 503, 'busy', {}, None)]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '千问'):
                self.check_queue(value)

    def test_qwen_not_started_is_allowed(self):
        self.check_queue(URLError(ConnectionRefusedError('not running')))

    def test_h3_malformed_queue_blocks(self):
        app = service()
        with patch.object(app, 'api', return_value={}), self.assertRaisesRegex(ValueError, 'H3'):
            app.gpu_idle()

    def test_lost_comfy_tool_task_stops_waiting_and_preserves_id(self):
        app = service()
        calls = []
        def api(path, data=None):
            calls.append((path, data))
            if path == '/prompt': return {'prompt_id': 'original-task'}
            if path == '/queue': return {'queue_running': [], 'queue_pending': []}
            return {}
        with tempfile.TemporaryDirectory() as directory:
            app.WORK = Path(directory)
            job = {'id': 'test', 'params': {}, 'runName': 'qa'}
            (app.WORK / 'test').mkdir()
            with patch.object(app, 'build_graph', return_value={}), patch.object(app, 'api', side_effect=api), patch.object(app, 'save'), patch.object(app.time, 'sleep', side_effect=[None, None, None, RuntimeError('probe exceeded four polls')]):
                with self.assertRaisesRegex(RuntimeError, '未找到.*original-task'):
                    app.run_comfy(job)
            self.assertEqual(job['promptId'], 'original-task')
            self.assertFalse(any(p in ['/interrupt'] or (p == '/queue' and body) for p, body in calls))

    def test_cancel_during_admission_does_not_start_gpu_work(self):
        app = service()
        job = {'id': 'test', 'params': {'operation': 'continuum'}}
        with patch.object(app, 'save'), patch.object(app, 'gpu_idle', side_effect=lambda: job.update(cancelRequested=True)), patch.object(app, 'run_comfy') as run:
            app.run_job(job)
        run.assert_not_called()
        self.assertEqual(job['status'], 'cancelled')

    def test_queued_task_and_completion_race_still_return_original_result(self):
        for queued in [False, True]:
            app = service()
            history_reads = 0
            def api(path, data=None):
                nonlocal history_reads
                if path == '/prompt': return {'prompt_id': 'original-task'}
                if path == '/queue': return {'queue_running': [], 'queue_pending': [[0, 'original-task']] if queued else []}
                history_reads += 1
                if history_reads < (5 if queued else 4):
                    return {}
                return {'original-task': {'status': {'status_str': 'success'}, 'outputs': {'92': {'images': [{'filename': 'result.mp4'}]}}}}
            with tempfile.TemporaryDirectory() as directory:
                app.WORK = Path(directory)
                folder = app.WORK / 'test'; folder.mkdir()
                job = {'id': 'test', 'params': {}, 'result': str(folder / 'result.mp4')}
                with patch.object(app, 'build_graph', return_value={}), patch.object(app, 'api', side_effect=api), patch.object(app, 'save'), patch.object(app.time, 'sleep'), patch.object(app.OPENER, 'open', return_value=io.BytesIO(b'original result')):
                    app.run_comfy(job)
                self.assertEqual(Path(job['result']).read_bytes(), b'original result')

    def test_cancel_only_interrupts_this_tool_prompt(self):
        app = service()
        calls = []
        interrupted = False
        with tempfile.TemporaryDirectory() as directory:
            app.WORK = Path(directory)
            (app.WORK / 'test').mkdir()
            job = {'id': 'test', 'params': {}}
            def api(path, data=None):
                nonlocal interrupted
                calls.append((path, data))
                if path == '/prompt': return {'prompt_id': 'own-task'}
                if path == '/interrupt': interrupted = True; return {}
                if path == '/queue': return {'queue_running': [] if interrupted else [[0, 'own-task']], 'queue_pending': [[1, 'other-task']]}
                job['cancelRequested'] = True
                return {}
            with patch.object(app, 'build_graph', return_value={}), patch.object(app, 'api', side_effect=api), patch.object(app, 'save'), patch.object(app.time, 'sleep'), self.assertRaises(InterruptedError):
                app.run_comfy(job)
            self.assertIn(('/interrupt', {'prompt_id': 'own-task'}), calls)
            self.assertIn(('/queue', {'delete': ['own-task']}), calls)

    def test_graphs_build_and_preserve_options(self):
        app = service()
        for op in ['continuum', 'handtie']:
            for size in [480, 720, 1080]:
                with self.subTest(op=op, size=size):
                    params = {'operation': op, 'projectId': 'qa', 'prompt': 'first\n---\nnext', 'seed': 17, 'chunks': 2, 'seconds': 5, 'resolution': size, 'orientation': 'portrait'}
                    job = {'id': 'qa', 'params': params, 'runName': 'qa-review'}
                    graph = app.build_graph(job)
                    self.assertEqual(graph['92']['class_type'], 'SaveVideo')
                    self.assertEqual(graph['canvas_output_size']['inputs']['width'], size)
                    for node in graph.values():
                        for value in node['inputs'].values():
                            if isinstance(value, list):
                                self.assertIn(value[0], graph)
                    if op == 'continuum':
                        n = graph['continuum']['inputs']
                        self.assertEqual(n['size_source'], 'Manual')
                        self.assertEqual(n['generation_mode'], 'Review Each Chunk')
                        self.assertEqual(n['run_name'], 'qa-review')
                        self.assertEqual(n['run_storage'], 'Save + Auto Resume')
                        params['reviewAction'] = 'Regenerate Current'
                        self.assertEqual(app.build_graph(job)['continuum']['inputs']['review_action'], 'Regenerate Current')
                    else:
                        self.assertEqual(graph['hand']['inputs']['steps'], 4)
                        self.assertEqual(graph['hand']['inputs']['aspect'], '9:16 portrait')

    def test_references_and_audio_are_wired(self):
        app = service()
        for op in ['continuum', 'handtie']:
            params = {'operation': op, 'projectId': 'qa', 'prompt': 'test', 'seed': 1, 'firstImage': 'first', 'audio': 'audio', 'voice': 'voice', 'source': 'video', 'references': ['ref']}
            with patch.object(app, 'asset', side_effect=lambda key: app.ASSETS / (key + ('.mp4' if key == 'video' else '.png'))):
                graph = app.build_graph({'id': 'qa', 'runName': 'qa', 'params': params})
            if op == 'continuum':
                self.assertEqual(graph['continuum']['inputs']['reference_image_1'], ['ref0', 0])
                self.assertEqual(graph['continuum']['inputs']['driving_audio'], ['audio', 0])
                self.assertEqual(graph['124']['inputs']['steps'], 4)
            else:
                self.assertEqual(graph['hand']['inputs']['master_audio_file'], 'canvas/audio.png')
                self.assertEqual(json.loads(graph['hand']['inputs']['ref_plan'])['refs'][0]['file'], 'canvas/ref.png')

if __name__ == '__main__':
    unittest.main()
