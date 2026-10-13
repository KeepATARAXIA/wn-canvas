const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { test } = require('node:test'), ts = require('../node_modules/typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/webdav-sync.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
async function check(status, size, body = 'abc') {
    const calls = [], deps = {'@/i18n': {t: key => key}, '@/stores/use-config-store': {withLocalProxy: url => url}};
    const exports = {};
    new Function('exports', 'require', 'fetch', 'window', code)(exports, s => deps[s], async (_url, init) => {
        calls.push(init.method);
        if(init.method === 'HEAD')return new Response(null,{status,headers:size===null?{}:{'Content-Length':String(size)}});
        return new Response(body);
    }, {setTimeout,clearTimeout});
    const result = await exports.webdavFileMatches({url:'http://test.invalid',directory:'',username:'',password:''},'file.mp4',3);
    return {result,calls};
}
test('HEAD checks presence and size without downloading existing media', async () => {
    assert.deepEqual(await check(200,3),{result:true,calls:['HEAD']});
    assert.deepEqual(await check(404,null),{result:false,calls:['HEAD']});
    assert.deepEqual(await check(200,1),{result:false,calls:['HEAD']});
});
test('unsupported HEAD or omitted length falls back to reading the media', async () => {
    assert.equal((await check(405,null)).result,true);
    assert.equal((await check(501,null)).result,true);
    assert.deepEqual(await check(200,null,'a'),{result:false,calls:['HEAD','GET']});
});
test('authentication and server failures do not pretend media is missing', async () => {
    await assert.rejects(check(403,null),/authenticationFailed/);
    await assert.rejects(check(503,null),/responseFailed/);
});
