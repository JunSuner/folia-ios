// ios/App/App/NativePlayerPlugin.swift
// iOS 版放网易云歌曲的原生播放器（AVQueuePlayer）。页面经 Folia 的外部播放器通道（playback.external@1，
// sources/netease/core/neteaseNativePlayback.ts）驱动它、跟着它的进度走；页面里的接口是 ios/native-player/bridge.js
// 包出来的 window.FoliaNativePlayer。现在这首和页面准备好的随后一两首在这里排着，放完自己接上下一首：App 在后台、
// 页面被系统冻住时也接得上，页面醒来问状态时看到播放器已经换了歌（上一首记在 finished 里），再认领（adopt）。
// 锁屏和控制中心的「正在播放」也在这里。播放、暂停、拖进度、排着下一首时的「下一首」由这里直接做；「上一首」和
// 没排下一首时的「下一首」经 remoteCommand 事件交给页面。
import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import Capacitor

/// 一首要放的歌：页面给的地址和锁屏上显示的信息。
private struct NativeTrack {
    let mediaId: String
    let url: URL
    let title: String
    let artist: String
    let album: String
    let artworkUrl: URL?
    let durationSec: Double?

    init?(_ object: JSObject?) {
        guard let object = object,
              let mediaId = object["mediaId"] as? String, !mediaId.isEmpty,
              let urlString = object["url"] as? String, let url = URL(string: urlString) else { return nil }
        self.mediaId = mediaId
        self.url = url
        title = object["title"] as? String ?? ""
        artist = object["artist"] as? String ?? ""
        album = object["album"] as? String ?? ""
        artworkUrl = (object["artworkUrl"] as? String).flatMap { URL(string: $0) }
        let durationMs = (object["durationMs"] as? NSNumber)?.doubleValue ?? 0
        durationSec = durationMs > 0 ? durationMs / 1000 : nil
    }
}

/// 队列里的一项：播放项、它是哪首歌、它的状态观察。播放项由这里强引用着，从队列里拿掉时一起丢掉。
private final class QueueEntry {
    let item: AVPlayerItem
    let track: NativeTrack
    var observation: NSKeyValueObservation?

    init(item: AVPlayerItem, track: NativeTrack) {
        self.item = item
        self.track = track
    }
}

/// 一次还在等播放项就绪的起播。call 是等着它的页面调用；没人等（继续、锁屏的播放重新载入）时为 nil。
private final class PendingStart {
    let call: CAPPluginCall?
    let item: AVPlayerItem
    let startSec: Double
    let createdAt = Date()
    var timeout: DispatchWorkItem?

    init(call: CAPPluginCall?, item: AVPlayerItem, startSec: Double) {
        self.call = call
        self.item = item
        self.startSec = startSec
    }
}

@objc(NativePlayerPlugin)
public class NativePlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePlayerPlugin"
    public let jsName = "NativePlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "adopt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRepeatOne", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    /// 起播最多等多久：地址打不开、网络断了时不让页面一直等。
    private static let startTimeout: TimeInterval = 20
    /// finished 最多记几首：页面冻住期间播放器最多自己接上页面准备好的那几首。
    private static let finishedLimit = 8

    private let player = AVQueuePlayer()
    private var entries: [QueueEntry] = []
    /// 现在这首；队列放完后也留着，状态里报它放完了。
    private var current: NativeTrack?
    /// 现在这首是播放器自己接上的（上一首放完、锁屏按了下一首），页面还没认领。
    private var movedOnByItself = false
    /// 上次起播之后放完或被锁屏跳过的歌（mediaId），页面再问到它们时答「放完了」。
    private var finished: [String] = []
    private var ended = false
    private var seeking = false
    private var repeatOne = false
    /// 听者要它出声（放、继续）还是停着（暂停、停止）：来电等打断结束后据此决定接不接着放。
    private var wantsToPlay = false
    /// 现在这首放不下去的原因；页面问状态时报错。
    private var failure: String?
    private var pendingStart: PendingStart?
    private var playerObservations: [NSKeyValueObservation] = []
    private var notificationTokens: [NSObjectProtocol] = []
    private var artwork: (url: URL, image: MPMediaItemArtwork)?
    private var artworkTask: URLSessionDataTask?

    override public func load() {
        player.actionAtItemEnd = .advance
        playerObservations.append(player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.currentItemChanged() }
        })
        playerObservations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.updateNowPlaying() }
        })
        let center = NotificationCenter.default
        notificationTokens.append(center.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            self?.itemPlayedToEnd(note.object as? AVPlayerItem)
        })
        notificationTokens.append(center.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: nil, queue: .main) { [weak self] note in
            guard let item = note.object as? AVPlayerItem else { return }
            let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            self?.itemFailed(item, error?.localizedDescription ?? "The song stopped before its end")
        })
        notificationTokens.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            self?.audioInterrupted(note)
        })
        DispatchQueue.main.async { [weak self] in self?.installRemoteCommands() }
    }

    // MARK: - 页面调用

    /// 起播 track（从 startSec 秒起），换掉队列里原有的一切；upcoming 是随后要接的歌。播放项就绪时 resolve。
    @objc func play(_ call: CAPPluginCall) {
        guard let track = NativeTrack(call.getObject("track")) else {
            call.reject("A track with a mediaId and a url is required", "EINVAL")
            return
        }
        let startSec = max(0, call.getDouble("startSec") ?? 0)
        let upcoming = (call.getArray("upcoming") ?? []).compactMap { NativeTrack($0 as? JSObject) }
        DispatchQueue.main.async { [self] in
            load(track, at: startSec, upcoming: upcoming, call: call)
        }
    }

    /// 播放器自己接上了 mediaId 这首（或者已经放过它），页面要放它：认领，不重新开始。认领不了时 adopted 为 false。
    @objc func adopt(_ call: CAPPluginCall) {
        let mediaId = call.getString("mediaId") ?? ""
        DispatchQueue.main.async { [self] in
            guard movedOnByItself, !mediaId.isEmpty else {
                call.resolve(["adopted": false])
                return
            }
            if current?.mediaId == mediaId, player.currentItem != nil {
                movedOnByItself = false
                CAPLog.print("[NativePlayer] the page took over the song the player moved on to")
                call.resolve(["adopted": true])
            } else if finished.contains(mediaId) {
                // 页面冻住时播放器已经放过了这首：页面问状态时答放完了，它再往下走。
                call.resolve(["adopted": true])
            } else {
                call.resolve(["adopted": false])
            }
        }
    }

    /// 现在这首是 after 时，把随后要接的歌换成 upcoming（相同的前段留着，已经缓冲的不丢）。
    @objc func prepare(_ call: CAPPluginCall) {
        let after = call.getString("after") ?? ""
        let upcoming = (call.getArray("upcoming") ?? []).compactMap { NativeTrack($0 as? JSObject) }
        DispatchQueue.main.async { [self] in
            guard current?.mediaId == after, player.currentItem != nil else {
                call.resolve(["prepared": false])
                return
            }
            setUpcoming(upcoming)
            call.resolve(["prepared": true])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            wantsToPlay = false
            player.pause()
            updateNowPlaying()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            resumePlayback()
            call.resolve()
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let seconds = max(0, call.getDouble("seconds") ?? 0)
        DispatchQueue.main.async { [self] in
            seek(to: seconds) { call.resolve() }
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let volume = min(1, max(0, call.getDouble("volume") ?? 1))
        DispatchQueue.main.async { [self] in
            player.volume = Float(volume)
            call.resolve()
        }
    }

    /// 单曲循环：开着时一首放完不往下走，从头再放。
    @objc func setRepeatOne(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async { [self] in
            repeatOne = enabled
            player.actionAtItemEnd = enabled ? .none : .advance
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            cancelPendingStart("The player was stopped")
            wantsToPlay = false
            player.pause()
            player.removeAllItems()
            dropAllEntries()
            current = nil
            movedOnByItself = false
            finished.removeAll()
            ended = false
            failure = nil
            updateNowPlaying()
            call.resolve()
        }
    }

    /// 播放器此刻的状态：现在这首、在不在放、位置和长度（毫秒）、放完没有、上次起播后放完的歌。
    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [self] in
            var answer: JSObject = [
                "mediaId": current?.mediaId ?? "",
                "isPlaying": false,
                "starting": false,
                "seeking": seeking,
                "ended": ended,
                "positionMs": 0,
                "durationMs": 0,
                "finished": finished.map { $0 as JSValue },
            ]
            if let track = current {
                let duration = durationSec(of: player.currentItem, track)
                answer["durationMs"] = duration * 1000
                if let item = player.currentItem {
                    answer["positionMs"] = finiteSeconds(item.currentTime()) * 1000
                    answer["isPlaying"] = player.timeControlStatus == .playing
                    answer["starting"] = wantsToPlay && player.timeControlStatus == .waitingToPlayAtSpecifiedRate
                } else if ended {
                    answer["positionMs"] = duration * 1000
                }
                if let failure { answer["error"] = failure }
            }
            call.resolve(answer)
        }
    }

    // MARK: - 队列

    private func entry(for item: AVPlayerItem?) -> QueueEntry? {
        guard let item else { return nil }
        return entries.first { $0.item === item }
    }

    private func makeEntry(_ track: NativeTrack) -> QueueEntry {
        // 精确定位：不开时无损（FLAC）的跳转按码率估算位置，实际放到的地方和报的时间能差出 20 秒以上
        // （拖到快结尾后进度条到头了歌还在放）；开了以后跳转和时间是准的，起播不变慢（2026-11-25 在 Mac 上用 240 秒的
        // FLAC 对比过：不开时报的时间走到 260.8 秒才放完，开了正好 240.0 秒）。
        let asset = AVURLAsset(url: track.url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let item = AVPlayerItem(asset: asset)
        let entry = QueueEntry(item: item, track: track)
        entry.observation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async { self?.itemStatusChanged(item) }
        }
        entries.append(entry)
        return entry
    }

    private func dropEntry(_ item: AVPlayerItem) {
        entries.removeAll { entry in
            guard entry.item === item else { return false }
            entry.observation?.invalidate()
            return true
        }
    }

    private func dropAllEntries() {
        for entry in entries { entry.observation?.invalidate() }
        entries.removeAll()
    }

    /// 换掉队列，从 startSec 起放 track。call 有时在就绪（或失败、超时）时回它。
    private func load(_ track: NativeTrack, at startSec: Double, upcoming: [NativeTrack], call: CAPPluginCall?) {
        activateSession()
        cancelPendingStart("Another song was started")
        player.pause()
        player.removeAllItems()
        dropAllEntries()
        current = track
        movedOnByItself = false
        finished.removeAll()
        ended = false
        failure = nil
        seeking = false
        wantsToPlay = true
        let entry = makeEntry(track)
        player.insert(entry.item, after: nil)
        setUpcoming(upcoming)
        if call != nil || startSec > 0.5 {
            // 就绪时回页面的调用；从中间起的就绪后先跳到位置。
            let pending = PendingStart(call: call, item: entry.item, startSec: startSec)
            pendingStart = pending
            if let call {
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, self.pendingStart === pending else { return }
                    self.pendingStart = nil
                    CAPLog.print("[NativePlayer] the song did not load within \(Int(Self.startTimeout)) s")
                    call.reject("The song did not load in time", "ETIMEDOUT")
                }
                pending.timeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.startTimeout, execute: timeout)
            }
        }
        // 从头放的直接开始（缓冲够了就出声）；从中间起的等就绪、跳到位置后再放，不先放出开头的一小段。
        if startSec <= 0.5 { player.play() }
        updateNowPlaying()
    }

    private func cancelPendingStart(_ reason: String) {
        guard let pending = pendingStart else { return }
        pendingStart = nil
        pending.timeout?.cancel()
        pending.call?.reject(reason, "ESUPERSEDED")
    }

    /// 现在这首之后排的歌换成 upcoming：和已经排着的相同的前段留着，其余拿掉再补上。
    private func setUpcoming(_ upcoming: [NativeTrack]) {
        guard player.currentItem != nil else { return }
        let queued = Array(player.items().dropFirst())
        var kept = 0
        while kept < queued.count, kept < upcoming.count, entry(for: queued[kept])?.track.mediaId == upcoming[kept].mediaId {
            kept += 1
        }
        for item in queued[kept...] {
            player.remove(item)
            dropEntry(item)
        }
        var after = player.items().last
        for track in upcoming[kept...] {
            let entry = makeEntry(track)
            guard player.canInsert(entry.item, after: after) else {
                dropEntry(entry.item)
                break
            }
            player.insert(entry.item, after: after)
            after = entry.item
        }
    }

    private func resumePlayback() {
        guard let track = current else { return }
        activateSession()
        if player.currentItem == nil || failure != nil {
            // 队列放完了，或者这首放不下去了：重新载入，放完的从头、出错的从原来的位置。
            let position = ended ? 0 : finiteSeconds(player.currentItem?.currentTime() ?? .zero)
            load(track, at: position, upcoming: [], call: nil)
            return
        }
        wantsToPlay = true
        player.play()
        updateNowPlaying()
    }

    private func seek(to seconds: Double, completion: @escaping () -> Void) {
        guard player.currentItem != nil else {
            completion()
            return
        }
        seeking = true
        let started = Date()
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 1000), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                CAPLog.print(String(format: "[NativePlayer] seeked to %.1f s in %.2f s", seconds, Date().timeIntervalSince(started)))
                self?.seeking = false
                self?.updateNowPlaying()
                completion()
            }
        }
    }

    // MARK: - 播放器的变化

    private func currentItemChanged() {
        // 从队列里拿掉了的项不再留着。
        let live = player.items()
        for entry in entries where !live.contains(where: { $0 === entry.item }) {
            entry.observation?.invalidate()
        }
        entries.removeAll { entry in !live.contains(where: { $0 === entry.item }) }
        if player.currentItem == nil, let track = current, !ended {
            // 队列放完了（换歌时队列只空一瞬，到这里时新的一项已经在了；停止时 current 已经清掉）。
            ended = true
            wantsToPlay = false
            notifyListeners("ended", data: ["mediaId": track.mediaId])
        } else if let entry = entry(for: player.currentItem), entry.track.mediaId != current?.mediaId {
            // 播放器自己接上了下一首。
            if let previous = current, !finished.contains(previous.mediaId) { noteFinished(previous.mediaId) }
            current = entry.track
            movedOnByItself = true
            ended = false
            failure = nil
            CAPLog.print("[NativePlayer] moved on to the next prepared song by itself")
            notifyListeners("trackChanged", data: ["mediaId": entry.track.mediaId])
        }
        updateNowPlaying()
    }

    private func noteFinished(_ mediaId: String) {
        finished.append(mediaId)
        if finished.count > Self.finishedLimit { finished.removeFirst(finished.count - Self.finishedLimit) }
    }

    private func itemPlayedToEnd(_ item: AVPlayerItem?) {
        guard let item else { return }
        // 放完时报的时间应当等于长度：差得多说明跳转后的时间不准。
        CAPLog.print(String(format: "[NativePlayer] a song played to its end at %.1f of %.1f s", finiteSeconds(item.currentTime()), item.duration.seconds))
        if repeatOne && player.currentItem === item {
            // 单曲循环：actionAtItemEnd 是 .none，这一项留在原处，从头再放。
            item.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self, self.wantsToPlay else { return }
                    self.player.play()
                    self.updateNowPlaying()
                }
            }
            return
        }
        // 队列往下走（或放完）由 currentItemChanged 看：那边先到时这一项已经拿掉了，它也会记下上一首放完。
        if let entry = entry(for: item), !finished.contains(entry.track.mediaId) { noteFinished(entry.track.mediaId) }
    }

    private func itemStatusChanged(_ item: AVPlayerItem) {
        guard entry(for: item) != nil else { return }
        switch item.status {
        case .readyToPlay:
            if let pending = pendingStart, pending.item === item {
                pendingStart = nil
                pending.timeout?.cancel()
                CAPLog.print(String(format: "[NativePlayer] a song was ready in %.2f s", Date().timeIntervalSince(pending.createdAt)))
                if pending.startSec > 0.5 {
                    seek(to: pending.startSec) { [weak self] in
                        guard let self else { return }
                        if self.wantsToPlay { self.player.play() }
                        pending.call?.resolve()
                    }
                } else {
                    pending.call?.resolve()
                }
            }
            updateNowPlaying()
        case .failed:
            itemFailed(item, item.error?.localizedDescription ?? "The song could not be loaded")
        default:
            break
        }
    }

    private func itemFailed(_ item: AVPlayerItem, _ message: String) {
        guard let entry = entry(for: item) else { return }
        CAPLog.print("[NativePlayer] a song failed: \(message)")
        if let pending = pendingStart, pending.item === item {
            pendingStart = nil
            pending.timeout?.cancel()
            failure = message
            pending.call?.reject(message, "ELOAD")
            return
        }
        if player.currentItem === item {
            failure = message
            player.pause()
            updateNowPlaying()
        } else {
            // 排着的歌载入失败（地址过期等）：拿掉，放到那里时队列停下，页面再按自己的队列往下走。
            player.remove(item)
            dropEntry(entry.item)
        }
    }

    private func audioInterrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended {
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            CAPLog.print("[NativePlayer] audio interruption ended (resume: \(options.contains(.shouldResume)))")
            if options.contains(.shouldResume), wantsToPlay, player.currentItem != nil {
                activateSession()
                player.play()
            }
        } else {
            CAPLog.print("[NativePlayer] audio interrupted")
        }
        updateNowPlaying()
    }

    // MARK: - 音频会话、锁屏

    private func activateSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            if session.category != .playback {
                try session.setCategory(.playback, mode: .default, policy: .longFormAudio)
            }
            try session.setActive(true)
        } catch {
            CAPLog.print("[NativePlayer] the audio session could not be activated: \(error)")
        }
    }

    private func installRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { [weak self] _ in
            guard let self, self.current != nil else { return .noActionableNowPlayingItem }
            self.resumePlayback()
            return .success
        }
        commands.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.wantsToPlay = false
            self.player.pause()
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self, self.current != nil else { return .noActionableNowPlayingItem }
            if self.player.timeControlStatus == .paused || self.player.currentItem == nil {
                self.resumePlayback()
            } else {
                self.wantsToPlay = false
                self.player.pause()
            }
            return .success
        }
        commands.nextTrackCommand.addTarget { [weak self] _ in
            guard let self, let track = self.current else { return .noActionableNowPlayingItem }
            if self.player.items().count > 1 {
                // 排着下一首：这里直接接上，页面下次问到这首时答放完了。
                self.noteFinished(track.mediaId)
                self.wantsToPlay = true
                self.player.advanceToNextItem()
                self.player.play()
            } else {
                self.notifyListeners("remoteCommand", data: ["command": "nexttrack"])
            }
            return .success
        }
        commands.previousTrackCommand.addTarget { [weak self] _ in
            guard let self, self.current != nil else { return .noActionableNowPlayingItem }
            self.notifyListeners("remoteCommand", data: ["command": "previoustrack"])
            return .success
        }
        commands.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self, let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(to: event.positionTime) {}
            return .success
        }
        for command in [commands.skipForwardCommand, commands.skipBackwardCommand, commands.seekForwardCommand,
                        commands.seekBackwardCommand, commands.changeRepeatModeCommand, commands.changeShuffleModeCommand,
                        commands.likeCommand, commands.dislikeCommand, commands.bookmarkCommand, commands.ratingCommand] {
            command.isEnabled = false
        }
    }

    private func finiteSeconds(_ time: CMTime) -> Double {
        let seconds = time.seconds
        return seconds.isFinite ? max(0, seconds) : 0
    }

    private func durationSec(of item: AVPlayerItem?, _ track: NativeTrack) -> Double {
        if let item, item.status == .readyToPlay {
            let seconds = item.duration.seconds
            if seconds.isFinite, seconds > 0 { return seconds }
        }
        return track.durationSec ?? 0
    }

    private func updateNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard let track = current else {
            center.nowPlayingInfo = nil
            return
        }
        let item = player.currentItem
        let duration = durationSec(of: item, track)
        let position = item.map { finiteSeconds($0.currentTime()) } ?? (ended ? duration : 0)
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyArtist: track.artist,
            MPMediaItemPropertyAlbumTitle: track.album,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        if let url = track.artworkUrl {
            if let artwork, artwork.url == url {
                info[MPMediaItemPropertyArtwork] = artwork.image
            } else {
                loadArtwork(url)
            }
        }
        center.nowPlayingInfo = info
    }

    private func loadArtwork(_ url: URL) {
        if artworkTask?.originalRequest?.url == url { return }
        artworkTask?.cancel()
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard let self else { return }
                self.artworkTask = nil
                self.artwork = (url, artwork)
                if self.current?.artworkUrl == url { self.updateNowPlaying() }
            }
        }
        artworkTask = task
        task.resume()
    }
}
