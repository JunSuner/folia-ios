// ios/netease-local/shims.d.ts
/// <reference types="vite/client" />

declare module 'real-buffer' {
    export { Buffer } from 'buffer';
}

declare module '*.cjs' {
    const value: Record<string, unknown>;
    export default value;
}

declare module '@neteasecloudmusicapienhanced/api/*';
