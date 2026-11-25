// ios/netease-local/test/compare.mjs
// 在 Mac 上用 Node 跑打包好的手机版服务（dist/netease-local/server.js，网络走 fetch），和 Mac 上的 Node 服务
// （默认 http://127.0.0.1:3300）回答同一组匿名请求，比对关键字段。只用匿名身份，不碰登录凭据。
// 用法：node ios/netease-local/test/compare.mjs [dist 目录]
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] || 'dist/netease-local');
const REMOTE = process.env.NETEASE_REMOTE || 'http://127.0.0.1:3300';
const LOCAL = 'http://netease.folia.local';
const SONG = 2132194277;

const { handle, describeState } = await import(pathToFileURL(path.join(dist, 'server.js')).href);

const ask = async (base, route) => {
    const started = performance.now();
    const response = base === LOCAL ? await handle(`${LOCAL}${route}`) : await fetch(`${base}${route}`);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
    return { status: response.status, body, ms: Math.round(performance.now() - started) };
};

// 第一次请求会先完成启动（xeapi 公钥、匿名注册）。
const anon = await ask(LOCAL, '/register/anonimous');
const anonCookie = typeof anon.body?.cookie === 'string' ? anon.body.cookie : '';
console.log('register/anonimous', anon.status, anon.body?.code, 'cookie:', anonCookie ? 'yes' : 'no', `${anon.ms}ms`);
console.log('state', describeState());
const withCookie = route => `${route}${route.includes('?') ? '&' : '?'}cookie=${encodeURIComponent(anonCookie)}`;

const pick = {
    '/song/detail?ids=SONG': b => ({ code: b.code, name: b.songs?.[0]?.name, artist: b.songs?.[0]?.ar?.[0]?.name, fee: b.songs?.[0]?.fee }),
    '/lyric/new?id=SONG': b => ({ code: b.code, lrc: (b.lrc?.lyric ?? '').length > 0, yrc: (b.yrc?.lyric ?? '').length > 0 }),
    '/song/url/v1?id=SONG&level=exhigh&randomCNIP=true&https=true': b => ({ code: b.code, hasUrl: Boolean(b.data?.[0]?.url), br: b.data?.[0]?.br, trial: Boolean(b.data?.[0]?.freeTrialInfo), level: b.data?.[0]?.level }),
    '/song/chorus?id=SONG': b => ({ code: b.code, chorus: Array.isArray(b.chorus) ? b.chorus.length : b.chorus }),
    '/cloudsearch?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6&limit=3': b => ({ code: b.code, count: b.result?.songs?.length, first: b.result?.songs?.[0]?.name }),
    '/playlist/detail?id=3778678': b => ({ code: b.code, name: b.playlist?.name, tracks: b.playlist?.trackCount }),
    '/playlist/track/all?id=3778678&limit=5': b => ({ code: b.code, songs: b.songs?.length }),
    '/toplist': b => ({ code: b.code, lists: b.list?.length }),
    '/album?id=32311': b => ({ code: b.code, name: b.album?.name, songs: b.songs?.length }),
    '/artist/detail?id=6452': b => ({ code: b.code, name: b.data?.artist?.name }),
    '/simi/song?id=SONG': b => ({ code: b.code, songs: b.songs?.length }),
    '/personalized?limit=3': b => ({ code: b.code, result: b.result?.length }),
    '/login/qr/key': b => ({ code: b.code, key: Boolean(b.data?.unikey) }),
    '/login/status': b => ({ code: b.data?.code ?? b.code, account: Boolean(b.data?.account) }),
    '/recommend/songs': b => ({ code: b.code }),
};

let mismatches = 0;
for (const [template, summarize] of Object.entries(pick)) {
    const route = withCookie(template.replace('SONG', String(SONG)));
    const [local, remote] = await Promise.all([ask(LOCAL, route), ask(REMOTE, route)]);
    const a = JSON.stringify({ status: local.status, ...summarize(local.body ?? {}) });
    const b = JSON.stringify({ status: remote.status, ...summarize(remote.body ?? {}) });
    const same = a === b;
    if (!same) mismatches++;
    console.log(`${same ? 'OK  ' : 'DIFF'} ${template}\n     phone ${a} ${local.ms}ms\n     mac   ${b} ${remote.ms}ms`);
}

const qrKey = await ask(LOCAL, '/login/qr/key');
const key = qrKey.body?.data?.unikey;
const qr = await ask(LOCAL, `/login/qr/create?key=${key}&qrimg=true`);
console.log('login/qr/create', qr.status, String(qr.body?.data?.qrurl ?? '').slice(0, 40), String(qr.body?.data?.qrimg ?? '').slice(0, 30));
const check = await ask(LOCAL, `/login/qr/check?key=${key}`);
console.log('login/qr/check', check.status, check.body?.code, check.body?.message);

console.log(mismatches ? `\n${mismatches} mismatch(es)` : '\nall matched');
