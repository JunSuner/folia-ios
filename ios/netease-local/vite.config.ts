// ios/netease-local/vite.config.ts
// 把网易云 API 包（@neteasecloudmusicapienhanced/api）原样打进 iOS App：包里 require 的 Node 内置模块和用不上的依赖
// 换成 shims/ 下的替身，并给包的每个文件注入 process / Buffer / global / __dirname。产物在 dist/netease-local/：
// server.js（server.ts，按接口分块按需加载）和 bootstrap.js（页面最前面的拦截脚本）。
// 构建：npx vite build -c ios/netease-local/vite.config.ts（在 npm run build:ios 里，主构建之后）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const packageDir = path.join(root, 'node_modules', '@neteasecloudmusicapienhanced', 'api');
const shim = (file: string) => path.join(here, 'shims', file);

const PACKAGE_SHIMS: Record<string, string> = {
    crypto: shim('crypto.ts'),
    fs: shim('fs.ts'),
    zlib: shim('node.ts'),
    path: shim('node.ts'),
    os: shim('node.ts'),
    url: shim('node.ts'),
    http: shim('node.ts'),
    https: shim('node.ts'),
    axios: shim('axios.ts'),
    tunnel: shim('stubs.ts'),
    'pac-proxy-agent': shim('stubs.ts'),
    dotenv: shim('stubs.ts'),
    jsdom: shim('stubs.ts'),
    '@neteasecloudmusicapienhanced/unblockmusic-utils': shim('stubs.ts'),
};

// 包自己的文件（不含它嵌套的 node_modules）。
const insidePackage = (id?: string) => Boolean(id)
    && id!.startsWith(packageDir + path.sep)
    && !id!.includes(`${path.sep}node_modules${path.sep}`, packageDir.length);

const neteaseShims = (): Plugin => ({
    name: 'folia-netease-local',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source === 'real-buffer') return path.join(root, 'node_modules', 'buffer', 'index.js');
        const id = source.startsWith('node:') ? source.slice(5) : source;
        if (insidePackage(importer) && id in PACKAGE_SHIMS) return PACKAGE_SHIMS[id];
        return null;
    },
    transform(code, id) {
        if (!insidePackage(id) || !id.endsWith('.js')) return null;
        const dir = `/ncm/${path.relative(packageDir, path.dirname(id)).split(path.sep).join('/')}`;
        const prelude = `var process = require(${JSON.stringify(shim('process.cjs'))}), `
            + `Buffer = require(${JSON.stringify(shim('buffer.ts'))}).Buffer, `
            + `global = require(${JSON.stringify(shim('global.cjs'))}), `
            + `__dirname = ${JSON.stringify(dir)};`;
        return { code: `${prelude}\n${code}`, map: null };
    },
    generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'bootstrap.js', source: fs.readFileSync(path.join(here, 'bootstrap.js'), 'utf8') });
    },
});

export default defineConfig({
    root,
    publicDir: false,
    envFile: false,
    plugins: [neteaseShims()],
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
        outDir: process.env.NETEASE_LOCAL_OUT_DIR || path.join(root, 'dist', 'netease-local'),
        emptyOutDir: true,
        copyPublicDir: false,
        target: 'es2022',
        minify: true,
        sourcemap: false,
        reportCompressedSize: false,
        lib: {
            entry: path.join(here, 'server.ts'),
            formats: ['es'],
            fileName: () => 'server.js',
        },
    },
});
