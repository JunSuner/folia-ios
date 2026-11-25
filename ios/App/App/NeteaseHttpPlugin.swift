// ios/App/App/NeteaseHttpPlugin.swift
// 手机内置网易云服务（ios/netease-local）发请求用的原生插件：WebView 里的 fetch 受跨域限制，也不能设置
// Cookie / Referer / User-Agent，这些请求改由 URLSession 发。Cookie 完全由 JS 那边（上游 util/request）管：
// 这里不存、不自动带、不接收 Cookie，响应里的 Set-Cookie 原样交回去。
import Foundation
import Capacitor

@objc(NeteaseHttpPlugin)
public class NeteaseHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NeteaseHttpPlugin"
    public let jsName = "NeteaseHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Invalid URL", "EINVAL")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = call.getString("method") ?? "GET"
        request.httpShouldHandleCookies = false
        if let timeoutMs = call.getDouble("timeoutMs"), timeoutMs > 0 {
            request.timeoutInterval = timeoutMs / 1000
        }
        if let headers = call.getObject("headers") {
            for (name, value) in headers {
                request.setValue(String(describing: value), forHTTPHeaderField: name)
            }
        }
        if let base64 = call.getString("bodyBase64") {
            request.httpBody = Data(base64Encoded: base64)
        } else if let body = call.getString("body") {
            request.httpBody = body.data(using: .utf8)
        }

        session.dataTask(with: request) { data, response, error in
            if let error = error as NSError? {
                let code = error.code == NSURLErrorTimedOut ? "ETIMEDOUT" : "ENETWORK"
                call.reject(error.localizedDescription, code, error)
                return
            }
            guard let http = response as? HTTPURLResponse else {
                call.reject("No HTTP response", "ENETWORK")
                return
            }
            var headers: [String: String] = [:]
            for (name, value) in http.allHeaderFields {
                headers[String(describing: name).lowercased()] = String(describing: value)
            }
            call.resolve([
                "status": http.statusCode,
                "headers": headers,
                "body": (data ?? Data()).base64EncodedString(),
            ])
        }.resume()
    }
}
