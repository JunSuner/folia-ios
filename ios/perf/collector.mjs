// ios/perf/collector.mjs
// Mac 上接收真机性能数据的小服务：POST /start /result /done，每次测试写一个 results/<runId>.jsonl。
// 用法：node ios/perf/collector.mjs [端口，默认 3399]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
fs.mkdirSync(DIR, { recursive: true });
const port = Number(process.argv[2] ?? 3399);

http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    if (req.method !== 'POST') { res.end('folia ios perf collector'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            const kind = req.url.replace(/^\//, '');
            const file = path.join(DIR, `${String(data.runId).replace(/[^\w-]/g, '_')}.jsonl`);
            fs.appendFileSync(file, JSON.stringify({ kind, at: new Date().toISOString(), ...data }) + '\n');
            console.log(`[collector] ${kind} ${data.style ?? ''} ${data.error ?? ''}`);
            res.end('ok');
        } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
        }
    });
}).listen(port, '0.0.0.0', () => console.log(`[collector] listening on ${port}, writing ${DIR}`));
