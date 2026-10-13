const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('../node_modules/typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/api/comfy-workflow.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const workflowApi = {};
new Function('exports', 'require', code)(workflowApi, () => ({}));

const preset = {
    id: 'builtin:qwen-image21-t2i',
    capability: 'image',
    workflow: {
        4: { class_type: 'TextEncode', inputs: { prompt: '' } },
        7: { class_type: 'KSampler', inputs: { seed: 1 } },
        9: { class_type: 'SaveImage', inputs: {} },
    },
    mapping: {
        prompt: { nodeId: '4', inputName: 'prompt' },
        seed: { nodeId: '7', inputName: 'seed' },
        imageSlots: [], videoSlots: [], audioSlots: [], outputNodeId: '9',
    },
};

test('Qwen cancellation targets the accepted prompt even when abort happens during submission', async () => {
    const controller = new AbortController();
    const requests = [];
    const request = async ({ url, method, ignoreAbort }) => {
        requests.push({ url, method, ignoreAbort });
        if (url.endsWith('/system_stats')) return {};
        if (url.endsWith('/prompt')) {
            assert.equal(ignoreAbort, true);
            controller.abort();
            return { prompt_id: 'own-prompt' };
        }
        if (url.endsWith('/api/jobs/own-prompt/cancel')) return { cancelled: true };
        throw new Error(`Unexpected request: ${url}`);
    };
    const script = workflowApi.buildComfyWorkflowScript(preset);
    const runner = new Function('prompt', 'images', 'videos', 'audios', 'params', 'baseUrl', 'request', 'poll', 'signal', 'onProgress', `"use strict"; return (async () => {\n${script}\n})();`);
    await assert.rejects(runner('test', [], [], [], {}, 'http://127.0.0.1:8189', request, () => { throw new Error('poll should not start'); }, controller.signal), { name: 'AbortError' });
    assert.deepEqual(requests.filter((item) => item.method === 'post').map((item) => item.url), [
        'http://127.0.0.1:8189/prompt',
        'http://127.0.0.1:8189/api/jobs/own-prompt/cancel',
    ]);
    assert.equal(requests.at(-1).ignoreAbort, true);
});
