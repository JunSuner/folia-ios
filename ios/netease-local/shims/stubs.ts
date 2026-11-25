// ios/netease-local/shims/stubs.ts
// 手机上用不到、也跑不起来的依赖：代理（tunnel / pac-proxy-agent）、dotenv、第三方解锁源、jsdom（收藏歌单的反作弊 token）。
// 只有真的被调用时才报错，加载时不出问题。

const unsupported = (what: string) => new Error(`${what} is not supported in the iOS build`);

// tunnel
export const httpsOverHttp = () => undefined;
export const httpOverHttp = () => undefined;

// pac-proxy-agent
export class PacProxyAgent {
    constructor(_url: string) {}
}

// dotenv
export const config = () => ({ parsed: {} });

// @neteasecloudmusicapienhanced/unblockmusic-utils
export const matchID = async () => {
    throw unsupported('Unblock (unblockmusic-utils)');
};

// jsdom：上游用它跑易盾的 Watchman SDK 生成反作弊 token，只有收藏歌单这类请求要。
export class JSDOM {
    constructor() {
        throw unsupported('The anti-cheat token (jsdom)');
    }
}
export class VirtualConsole {
    on() { return this; }
    sendTo() { return this; }
}
