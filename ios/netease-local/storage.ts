// ios/netease-local/storage.ts
// 手机上的小块持久存储（匿名 token、xeapi 公钥这些，桌面版写在系统临时目录）。App 里用 WebView 的 localStorage；
// 在 Node 里跑测试时没有它，就放在内存里。
const PREFIX = 'folia-netease-local:';
const memory = new Map<string, string>();

const local = (): Storage | null => {
    try {
        return typeof globalThis.localStorage?.getItem === 'function' ? globalThis.localStorage : null;
    } catch {
        return null;
    }
};

export const storage = {
    get(key: string): string | null {
        const store = local();
        return store ? store.getItem(PREFIX + key) : (memory.get(key) ?? null);
    },
    set(key: string, value: string) {
        const store = local();
        if (store) store.setItem(PREFIX + key, value);
        else memory.set(key, value);
    },
    remove(key: string) {
        const store = local();
        if (store) store.removeItem(PREFIX + key);
        else memory.delete(key);
    },
};
