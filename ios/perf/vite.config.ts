import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import base from '../../dev/perf/vite.config';

// ios/perf/vite.config.ts
// 真机性能测试版的网页：沿用 dev/perf 的测量页（同样的插件、别名、常量），只换入口和输出目录。
// index.html 是驱动页（逐个样式跳转、汇总、上报），stage.html 是 dev/perf/page.tsx 加一段自动测量脚本。
// 按发布版的方式压缩，数字才接近真实 App。

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default mergeConfig(base, {
    cacheDir: path.join(HERE, '.build', 'vite-cache'),
    build: {
        outDir: path.join(HERE, '.build', 'dist'),
        minify: true,
        rollupOptions: {
            input: {
                index: path.join(HERE, 'index.html'),
                stage: path.join(HERE, 'stage.html'),
            },
        },
    },
});
