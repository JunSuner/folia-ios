// ios/netease-local/shims/fs.ts
// 网易云 API 包读写的文件：系统临时目录下的 anonymous_token、xeapi_public_key、neapi_key（存进 storage.ts），
// 和包自带的 data/china_ip_ranges.txt（打包时内联）。只认文件名，不管目录。
import chinaIpRanges from '../../../node_modules/@neteasecloudmusicapienhanced/api/data/china_ip_ranges.txt?raw';
import { storage } from '../storage';
import { Buffer } from './buffer';

const BUNDLED: Record<string, string> = { 'china_ip_ranges.txt': chinaIpRanges };
const fileName = (path: unknown) => String(path).split('/').pop() ?? '';
const key = (path: unknown) => `fs:${fileName(path)}`;

const notFound = (path: unknown) => Object.assign(new Error(`ENOENT: no such file or directory, open '${String(path)}'`), {
    code: 'ENOENT',
    errno: -2,
    path: String(path),
});

const encodingOf = (options: unknown) => (typeof options === 'string' ? options : (options as { encoding?: string } | undefined)?.encoding);

export const existsSync = (path: unknown) => fileName(path) in BUNDLED || storage.get(key(path)) !== null;

export const readFileSync = (path: unknown, options?: unknown) => {
    let text = BUNDLED[fileName(path)] ?? storage.get(key(path));
    if (text === null || text === undefined) {
        // 上游 util/request 加载时就读 anonymous_token，不先看在不在：没有时当成空的。
        if (fileName(path) !== 'anonymous_token') throw notFound(path);
        text = '';
    }
    return encodingOf(options) ? text : Buffer.from(text, 'utf8');
};

export const writeFileSync = (path: unknown, data: unknown) => {
    storage.set(key(path), typeof data === 'string' ? data : Buffer.from(data as Uint8Array).toString('utf8'));
};

export const unlinkSync = (path: unknown) => storage.remove(key(path));
export const mkdirSync = () => undefined;
export const statSync = (path: unknown) => {
    if (!existsSync(path)) throw notFound(path);
    return { isFile: () => true, isDirectory: () => false, size: 0, mtimeMs: 0 };
};

export const promises = {
    readFile: async (path: unknown, options?: unknown) => readFileSync(path, options),
    writeFile: async (path: unknown, data: unknown) => writeFileSync(path, data),
    readdir: async () => [] as string[],
    unlink: async (path: unknown) => unlinkSync(path),
};

export const createReadStream = () => {
    throw new Error('fs.createReadStream is not supported in the iOS build');
};
