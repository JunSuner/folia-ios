// ios/netease-local/shims/crypto.ts
// Node 的 crypto 在手机上的替身，只实现网易云 API 包真正调用的那几个：AES（ecb / cbc / gcm）、HMAC 与哈希、
// 随机数、X25519（xeapi 的密钥交换）。算法用 noble 的纯 JS 实现（同步，和 Node 的调用方式一致）。
import { cbc, ecb, gcm } from '@noble/ciphers/aes.js';
import { hmac } from '@noble/hashes/hmac.js';
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { Buffer } from './buffer';

type Input = string | Uint8Array | ArrayBuffer;

const toBytes = (value: Input, encoding?: string): Uint8Array => {
    if (typeof value === 'string') return Buffer.from(value, (encoding ?? 'utf8') as BufferEncoding);
    if (value instanceof Uint8Array) return value;
    return new Uint8Array(value);
};

const output = (bytes: Uint8Array, encoding?: string) => {
    const buf = Buffer.from(bytes);
    return encoding ? buf.toString(encoding as BufferEncoding) : buf;
};

export const randomBytes = (size: number) => {
    const buf = Buffer.alloc(size);
    globalThis.crypto.getRandomValues(buf);
    return buf;
};

const cipherMode = (algorithm: string) => {
    const match = /^aes-(128|192|256)-(ecb|cbc|gcm)$/i.exec(algorithm);
    if (!match) throw new Error(`crypto shim: unsupported cipher ${algorithm}`);
    return match[2].toLowerCase() as 'ecb' | 'cbc' | 'gcm';
};

// 和 Node 一样分 update / final 调用，但先把输入攒起来，final 时一次算完（网易云的请求都很小）。
class Cipher {
    private readonly chunks: Uint8Array[] = [];
    private authTag?: Uint8Array;
    private aad?: Uint8Array;
    private padding = true;

    constructor(
        private readonly algorithm: string,
        private readonly key: Uint8Array,
        private readonly iv: Uint8Array,
        private readonly decrypting: boolean,
    ) {
        cipherMode(algorithm);
    }

    update(data: Input, inputEncoding?: string, outputEncoding?: string) {
        this.chunks.push(toBytes(data, inputEncoding));
        return outputEncoding ? '' : Buffer.alloc(0);
    }

    setAAD(aad: Input) { this.aad = toBytes(aad); return this; }
    setAuthTag(tag: Input) { this.authTag = toBytes(tag); return this; }
    setAutoPadding(on = true) { this.padding = on; return this; }

    getAuthTag() {
        if (!this.authTag) throw new Error('crypto shim: getAuthTag() before final()');
        return Buffer.from(this.authTag);
    }

    final(outputEncoding?: string) {
        const input = Buffer.concat(this.chunks);
        const mode = cipherMode(this.algorithm);
        let result: Uint8Array;
        if (mode === 'gcm') {
            const aes = gcm(this.key, this.iv, this.aad);
            if (this.decrypting) {
                if (!this.authTag) throw new Error('crypto shim: gcm decrypt needs setAuthTag()');
                result = aes.decrypt(Buffer.concat([input, this.authTag]));
            } else {
                const sealed = aes.encrypt(input);
                result = sealed.subarray(0, sealed.length - 16);
                this.authTag = sealed.subarray(sealed.length - 16);
            }
        } else {
            const options = { disablePadding: !this.padding };
            const aes = mode === 'ecb' ? ecb(this.key, options) : cbc(this.key, this.iv, options);
            result = this.decrypting ? aes.decrypt(input) : aes.encrypt(input);
        }
        return output(result, outputEncoding);
    }
}

const ivBytes = (iv: Input | null | undefined) => (iv == null ? new Uint8Array(0) : toBytes(iv));
export const createCipheriv = (algorithm: string, key: Input, iv?: Input | null) => new Cipher(algorithm, toBytes(key), ivBytes(iv), false);
export const createDecipheriv = (algorithm: string, key: Input, iv?: Input | null) => new Cipher(algorithm, toBytes(key), ivBytes(iv), true);

const HASHES = { md5, sha1, sha256, sha512 } as const;
const pickHash = (algorithm: string) => {
    const hash = HASHES[algorithm.toLowerCase().replace('-', '') as keyof typeof HASHES];
    if (!hash) throw new Error(`crypto shim: unsupported hash ${algorithm}`);
    return hash;
};

class Hash {
    private readonly chunks: Uint8Array[] = [];
    constructor(private readonly hash: (typeof HASHES)[keyof typeof HASHES], private readonly key?: Uint8Array) {}
    update(data: Input, encoding?: string) { this.chunks.push(toBytes(data, encoding)); return this; }
    digest(encoding?: string) {
        const data = Buffer.concat(this.chunks);
        return output(this.key ? hmac(this.hash, this.key, data) : this.hash(data), encoding);
    }
}

export const createHash = (algorithm: string) => new Hash(pickHash(algorithm));
export const createHmac = (algorithm: string, key: Input) => new Hash(pickHash(algorithm), toBytes(key));

// X25519：Node 用 DER 的 SubjectPublicKeyInfo 表示公钥（固定 12 字节头 + 32 字节原始公钥）。
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

class KeyObject {
    readonly asymmetricKeyType = 'x25519';
    constructor(readonly type: 'public' | 'private', readonly raw: Uint8Array) {}
    export(options?: { format?: string; type?: string }) {
        if (this.type === 'public' && options?.format === 'der' && options.type === 'spki') {
            return Buffer.concat([X25519_SPKI_PREFIX, this.raw]);
        }
        throw new Error('crypto shim: unsupported key export');
    }
}

export const generateKeyPairSync = (type: string) => {
    if (type !== 'x25519') throw new Error(`crypto shim: unsupported key pair ${type}`);
    const secret = x25519.utils.randomSecretKey();
    return { privateKey: new KeyObject('private', secret), publicKey: new KeyObject('public', x25519.getPublicKey(secret)) };
};

export const createPublicKey = (input: { key: Input; format?: string; type?: string }) => {
    const key = toBytes(input.key);
    if (input.format === 'der' && input.type === 'spki' && key.length === 44) return new KeyObject('public', key.subarray(12));
    throw new Error('crypto shim: unsupported public key');
};

export const diffieHellman = ({ privateKey, publicKey }: { privateKey: KeyObject; publicKey: KeyObject }) => (
    Buffer.from(x25519.getSharedSecret(privateKey.raw, publicKey.raw))
);

export const randomUUID = () => globalThis.crypto.randomUUID();
