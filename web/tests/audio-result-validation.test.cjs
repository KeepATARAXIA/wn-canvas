const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { test } = require('node:test'), ts = require('../node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/api/audio.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
async function run(result, response, direct = false) {
    const signal = new AbortController().signal;
    let downloadSignal;
    const deps = {
        axios: {isCancel: () => false, isAxiosError: () => false, post: async () => ({data: result})}, '@/i18n': {t: (s, p) => s + (p ? JSON.stringify(p) : '')},
        '@/lib/audio-generation': {audioMimeType: () => 'audio/mpeg', normalizeAudioFormatValue: () => 'mp3', normalizeAudioSpeedValue: () => '1', normalizeAudioVoiceValue: () => 'alloy'},
        '@/services/file-storage': {}, '@/stores/use-config-store': {resolveModelRequestConfig: c => c, channelRequiresApiKey: () => false, withLocalProxy: u => u, buildApiUrl: () => 'https://test.invalid'},
        './model-plugin': {runModelPlugin: async () => result}, './comfy-workflow': {resolveModelExecutionScript: async () => direct ? '' : 'test'}, './auth-headers': {bearerAuthHeaders: () => ({})},
    };
    const exports = {};
    new Function('exports', 'require', 'fetch', code)(exports, s => {assert.ok(s in deps, s); return deps[s];}, async (_u, init) => {downloadSignal = init?.signal; return response;});
    const blob = await exports.requestAudioGeneration({model: 'audio', baseUrl: 'https://test.invalid', apiKey: '', audioInstructions: ''}, 'test', {signal});
    return {blob, downloadSignal, signal};
}
test('404 HTML URL rejects rather than producing audio', async () => {
    await assert.rejects(run({url: 'https://test.invalid/a'}, new Response('<html>expired</html>', {status: 404, headers: {'Content-Type': 'text/html'}})), /notFound|404/);
});
test('HTTP error preserves structured provider error', async () => {
    await assert.rejects(run({url: 'https://test.invalid/a'}, new Response('{"error":{"message":"audio link expired"}}', {status: 403, headers: {'Content-Type': 'application/json'}})), /audio link expired/);
});
for (const [type, body] of [['text/html', '<html>error</html>'], ['application/json', '{"error":{"message":"quota exhausted"}}'], ['audio/mpeg', '<!DOCTYPE html><html>error</html>'], ['application/octet-stream', '{"message":"bad request"}'], ['audio/wav', ''], ['image/png', 'not audio']]) {
    test(`reject invalid successful body ${type} ${body.slice(0, 15)}`, async () => {
        await assert.rejects(run(new Blob([body], {type})));
        await assert.rejects(run(new Blob([body], {type}), null, true));
    });
}
test('valid audio URL keeps bytes and forwards cancellation signal', async () => {
    const bytes = new Uint8Array([73, 68, 51, 4, 0, 0, 1, 2]);
    const r = await run({url: 'https://test.invalid/a'}, new Response(bytes, {headers: {'Content-Type': 'audio/mpeg'}}));
    assert.deepEqual(new Uint8Array(await r.blob.arrayBuffer()), bytes);
    assert.equal(r.downloadSignal, r.signal);
});
test('generic binary blob remains supported', async () => {
    const r = await run(new Blob([new Uint8Array([82,73,70,70,0,0,0,0,87,65,86,69])], {type: 'application/octet-stream'}));
    assert.equal(r.blob.type, 'audio/mpeg');
    assert.equal(r.blob.size, 12);
});
