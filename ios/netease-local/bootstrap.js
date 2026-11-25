// ios/netease-local/bootstrap.js
// iOS 版在页面最前面加载的普通脚本（vite.config.ts 的 capacitor 构建注入）：把发往手机内置网易云服务的 fetch
// 转给 /netease-local/server.js（第一次用到时才加载）。地址要和 .env.capacitor 的 VITE_NETEASE_API_BASE 一致；
// 那里配的是别的地址（例如 Mac 上的服务）时，这里什么都不拦。
(function () {
    var BASE = 'http://netease.folia.local';
    var originalFetch = window.fetch.bind(window);
    var server = null;
    var loadServer = function () {
        if (!server) {
            server = import('/netease-local/server.js').catch(function (error) {
                server = null;
                throw error;
            });
        }
        return server;
    };
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input && input.url));
        if (typeof url === 'string' && (url === BASE || url.indexOf(BASE + '/') === 0 || url.indexOf(BASE + '?') === 0)) {
            // 日志只写路径，不写查询参数（里面有登录 cookie）。
            var route = url.slice(BASE.length).split('?')[0];
            var started = performance.now();
            return loadServer().then(function (module) { return module.handle(url, init); }).then(function (response) {
                console.info('[netease-local] ' + route + ' ' + response.status + ' ' + Math.round(performance.now() - started) + 'ms');
                return response;
            }, function (error) {
                console.warn('[netease-local] ' + route + ' failed: ' + (error && error.message ? error.message : error));
                throw error;
            });
        }
        return originalFetch(input, init);
    };
})();
