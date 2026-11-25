// ios/netease-local/shims/node.ts
// 网易云 API 包里其余 Node 内置模块的替身：zlib（gzip 解压）、path、os、url、http/https 的 Agent。
// 都只做包里实际用到的部分。
import { gunzipSync as fflateGunzip, gzipSync as fflateGzip, inflateSync as fflateInflate, deflateSync as fflateDeflate } from 'fflate';
import { Buffer } from './buffer';

const bytes = (value: Uint8Array | string) => (typeof value === 'string' ? Buffer.from(value) : value);

// zlib：没有 zstdCompressSync，包里的 util/zstd.js 会自己退回到纯 JS（fzstd）。
export const gunzipSync = (input: Uint8Array) => Buffer.from(fflateGunzip(bytes(input)));
export const gzipSync = (input: Uint8Array | string) => Buffer.from(fflateGzip(bytes(input)));
export const inflateSync = (input: Uint8Array) => Buffer.from(fflateInflate(bytes(input)));
export const deflateSync = (input: Uint8Array | string) => Buffer.from(fflateDeflate(bytes(input)));

// path（只有 POSIX）
const normalize = (value: string) => {
    const parts: string[] = [];
    for (const segment of value.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') parts.pop();
        else parts.push(segment);
    }
    return `/${parts.join('/')}`;
};
export const sep = '/';
export const join = (...parts: string[]) => normalize(parts.join('/'));
export const resolve = (...parts: string[]) => normalize(parts.reduce((acc, part) => (part.startsWith('/') ? part : `${acc}/${part}`), ''));
export const basename = (value: string, ext?: string) => {
    const base = value.split('/').filter(Boolean).pop() ?? '';
    return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
};
export const dirname = (value: string) => normalize(`${value}/..`);
export const extname = (value: string) => {
    const base = basename(value);
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot) : '';
};
export const posix = { sep, join, resolve, basename, dirname, extname };

// os：包把匿名 token 等写在 tmpdir 下，fs 替身只看文件名，这里给个固定目录。
export const tmpdir = () => '/tmp';
export const platform = () => 'ios';
export const type = () => 'Darwin';
export const arch = () => 'arm64';
export const release = () => '';
export const hostname = () => 'iphone';
export const homedir = () => '/';
export const networkInterfaces = () => ({});
export const userInfo = () => ({ username: 'mobile' });
export const EOL = '\n';

// url
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

// http / https：包给每个请求建 Agent，网络实际由原生插件发，Agent 用不上。
export class Agent {
    constructor(_options?: unknown) {}
}
