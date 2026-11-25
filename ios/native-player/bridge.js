// ios/native-player/bridge.js
// iOS 版在页面最前面加载的普通脚本（vite.config.ts 的 capacitor 构建注入，和 netease-local/bootstrap.js 并列）：
// 把 App 自带的原生播放器（ios/App/App/NativePlayerPlugin.swift）包成 window.FoliaNativePlayer。网易云音源看到它，
// 就把歌交给原生播放器放（sources/netease/core/neteaseNativePlayback.ts）。不在 App 里、或 App 没有这个插件时什么都不做。
// 锁屏上的「上一首」、没排下一首时的「下一首」由原生转回来，这里交给页面登记的 Media Session 处理函数
// （src/hooks/useMediaSessionBridge.ts）：页面自己不出声时 WKWebView 不会调它们。
(function () {
    var cap = window.Capacitor;
    var headers = cap && cap.PluginHeaders;
    var hasPlugin = Array.isArray(headers) && headers.some(function (header) { return header && header.name === 'NativePlayer'; });
    if (!cap || typeof cap.nativePromise !== 'function' || typeof cap.addListener !== 'function' || !hasPlugin) return;

    var call = function (method, options) {
        return cap.nativePromise('NativePlayer', method, options || {});
    };

    // 页面登记的 Media Session 处理函数，按动作记下来。这个 WebView 没有 Media Session 时补一个只记处理函数的。
    var handlers = {};
    var session = navigator.mediaSession;
    if (!session) {
        session = { metadata: null, playbackState: 'none', setPositionState: function () {}, setActionHandler: function () {} };
        try {
            Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
        } catch (error) {
            console.warn('[NativePlayer] could not add navigator.mediaSession', error);
        }
        if (typeof window.MediaMetadata !== 'function') {
            window.MediaMetadata = function MediaMetadata(init) {
                Object.assign(this, { title: '', artist: '', album: '', artwork: [] }, init || {});
            };
        }
    }
    var setActionHandler = typeof session.setActionHandler === 'function' ? session.setActionHandler.bind(session) : null;
    session.setActionHandler = function (action, handler) {
        handlers[action] = handler;
        if (!setActionHandler) return;
        try {
            setActionHandler(action, handler);
        } catch (error) {
            // 这个 WebView 不认的动作：照样记下，锁屏按键转过来时用。
        }
    };

    cap.addListener('NativePlayer', 'remoteCommand', function (data) {
        var action = data && data.command;
        var handler = action ? handlers[action] : null;
        console.info('[NativePlayer] lock screen ' + action + (handler ? '' : ': the page has no handler for it'));
        if (handler) handler({ action: action });
    });
    // 播放器自己换了歌、整个队列放完：页面被冻住时这个事件会把它叫醒一下，页面按时去问的状态随后就到。
    cap.addListener('NativePlayer', 'trackChanged', function () {});
    cap.addListener('NativePlayer', 'ended', function () {});

    window.FoliaNativePlayer = {
        play: function (options) { return call('play', options); },
        adopt: function (options) { return call('adopt', options); },
        prepare: function (options) { return call('prepare', options); },
        pause: function () { return call('pause'); },
        resume: function () { return call('resume'); },
        seek: function (options) { return call('seek', options); },
        setVolume: function (options) { return call('setVolume', options); },
        setRepeatOne: function (options) { return call('setRepeatOne', options); },
        stop: function () { return call('stop'); },
        status: function () { return call('status'); },
        // 宿主存的音质（useAudioSettingsStore 的 default_audio_quality）：外部播放器的 play 不带音质，音源按它取地址。
        audioQuality: function () {
            try {
                return localStorage.getItem('default_audio_quality');
            } catch (error) {
                return null;
            }
        },
    };
})();
