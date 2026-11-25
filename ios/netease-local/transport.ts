// ios/netease-local/transport.ts
// 网易云请求真正发出去的地方。App 里用原生插件 NeteaseHttp（ios/App/App/NeteaseHttpPlugin.swift，URLSession）：
// 不受 WebView 的跨域限制，Cookie / Referer / User-Agent 这些头也能照上游的写法设置。不在 App 里（Node 里跑测试）时用 fetch。
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Buffer } from './shims/buffer';

export interface WireRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array;
    timeoutMs?: number;
}

export interface WireResponse {
    status: number;
    /** 名字都是小写；不含 set-cookie。 */
    headers: Record<string, string>;
    setCookie: string[];
    body: Uint8Array;
}

type Transport = (request: WireRequest) => Promise<WireResponse>;

interface NativeAnswer {
    status: number;
    headers: Record<string, string>;
    body: string;
}

interface NeteaseHttpPlugin {
    request: (options: Record<string, unknown>) => Promise<NativeAnswer>;
}

// URLSession 把多条 Set-Cookie 用逗号连成一条；按「逗号后面紧跟 名字=」拆开（Expires 里的逗号后面是日期，不会被拆）。
export const splitSetCookie = (value: string) => value.split(/,(?=\s*[^;,=\s]+=)/).map(part => part.trim()).filter(Boolean);

// Folia 的页面本身不加载 @capacitor/core，这里自己引入（它会接上原生桥注入的 window.Capacitor）。
const nativeTransport = (): Transport | null => {
    if (!Capacitor.isNativePlatform()) return null;
    const plugin = registerPlugin<NeteaseHttpPlugin>('NeteaseHttp');
    return async (request) => {
        const answer = await plugin.request({
            url: request.url,
            method: request.method,
            headers: request.headers,
            timeoutMs: request.timeoutMs ?? 0,
            ...(typeof request.body === 'string'
                ? { body: request.body }
                : request.body ? { bodyBase64: Buffer.from(request.body).toString('base64') } : {}),
        });
        const headers: Record<string, string> = {};
        let setCookie: string[] = [];
        for (const [name, value] of Object.entries(answer.headers ?? {})) {
            const lower = name.toLowerCase();
            if (lower === 'set-cookie') setCookie = splitSetCookie(String(value));
            else headers[lower] = String(value);
        }
        return { status: answer.status, headers, setCookie, body: Buffer.from(answer.body ?? '', 'base64') };
    };
};

const fetchTransport: Transport = async (request) => {
    const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body as string | Uint8Array<ArrayBuffer> | undefined,
        redirect: 'follow',
        ...(request.timeoutMs ? { signal: AbortSignal.timeout(request.timeoutMs) } : {}),
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') headers[name] = value;
    });
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    return {
        status: response.status,
        headers,
        setCookie: getSetCookie ? getSetCookie.call(response.headers) : [],
        body: new Uint8Array(await response.arrayBuffer()),
    };
};

let transport: Transport | null = null;

/** 测试用：换掉发请求的方式。 */
export const setTransport = (next: Transport | null) => {
    transport = next;
};

export const send = (request: WireRequest) => {
    transport ??= nativeTransport() ?? fetchTransport;
    return transport(request);
};
