// ios/netease-local/shims/buffer.ts
// 网易云 API 包用的 Buffer：npm 的 buffer 包（feross），补上它不认识的 base64url 编码（xeapi 的 C 字段用到）。
import { Buffer } from 'real-buffer';

const toBase64Url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const originalToString = Buffer.prototype.toString;
Buffer.prototype.toString = function toString(this: Buffer, encoding?: string, start?: number, end?: number) {
    if (encoding === 'base64url') return toBase64Url(originalToString.call(this, 'base64', start, end));
    return originalToString.call(this, encoding as BufferEncoding, start, end);
} as typeof Buffer.prototype.toString;

const originalFrom = Buffer.from;
Buffer.from = function from(this: typeof Buffer, value: unknown, encoding?: unknown, length?: unknown) {
    if (encoding === 'base64url' && typeof value === 'string') {
        return originalFrom.call(this, value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    }
    return (originalFrom as (...args: unknown[]) => Buffer).call(this, value, encoding, length);
} as typeof Buffer.from;

export { Buffer };
export default { Buffer };
