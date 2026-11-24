import type { CapacitorConfig } from '@capacitor/cli';

// iOS 壳的 Capacitor 配置：页面来自 vite 的 dist，深色底避免启动白闪
const config: CapacitorConfig = {
    appId: 'dev.folia.ios',
    appName: 'Folia',
    webDir: 'dist',
    backgroundColor: '#09090b',
    ios: {
        contentInset: 'never',
        backgroundColor: '#09090b',
        scrollEnabled: false,
        limitsNavigationsToAppBoundDomains: false,
    },
};

export default config;
