// ios/netease-local/shims/axios.ts
// 网易云 API 包只用 axios 发 POST：这里按 Node 版 axios 的行为收发，网络交给 transport.ts（App 里是原生插件）。
// 和 Node 版一致的地方：非 2xx 当成失败抛出；responseType 为 arraybuffer 时 data 是 Buffer，否则能解析成 JSON 就解析；
// 响应头名字都是小写，set-cookie 是数组。
import { Buffer } from './buffer';
import { send } from '../transport';

interface AxiosSettings {
    method?: string;
    url: string;
    headers?: Record<string, unknown>;
    data?: unknown;
    timeout?: number;
    responseType?: string;
}

const DEFAULT_ACCEPT = 'application/json, text/plain, */*';

const axios = async (settings: AxiosSettings) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(settings.headers ?? {})) {
        if (value !== undefined && value !== null) headers[name] = String(value);
    }
    const has = (name: string) => Object.keys(headers).some(key => key.toLowerCase() === name);
    if (!has('accept')) headers.Accept = DEFAULT_ACCEPT;

    let body: string | Uint8Array | undefined;
    if (typeof settings.data === 'string') body = settings.data;
    else if (settings.data instanceof Uint8Array) body = settings.data;
    else if (settings.data !== undefined && settings.data !== null) {
        body = JSON.stringify(settings.data);
        if (!has('content-type')) headers['Content-Type'] = 'application/json';
    }
    if (typeof body === 'string' && !has('content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const response = await send({
        url: settings.url,
        method: (settings.method ?? 'GET').toUpperCase(),
        headers,
        body,
        timeoutMs: settings.timeout && settings.timeout > 0 ? settings.timeout : undefined,
    });

    const responseHeaders: Record<string, string | string[]> = { ...response.headers };
    if (response.setCookie.length) responseHeaders['set-cookie'] = response.setCookie;
    const raw = Buffer.from(response.body);
    let data: unknown = raw;
    if (settings.responseType !== 'arraybuffer') {
        const text = raw.toString('utf8');
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    const result = { status: response.status, statusText: '', headers: responseHeaders, data, config: settings };
    if (response.status < 200 || response.status >= 300) {
        throw Object.assign(new Error(`Request failed with status code ${response.status}`), { response: result, code: 'ERR_BAD_RESPONSE' });
    }
    return result;
};

axios.get = (url: string, config: Partial<AxiosSettings> = {}) => axios({ ...config, url, method: 'GET' });
axios.post = (url: string, data?: unknown, config: Partial<AxiosSettings> = {}) => axios({ ...config, url, data, method: 'POST' });

export default axios;
