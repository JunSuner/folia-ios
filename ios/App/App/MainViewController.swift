// ios/App/App/MainViewController.swift
// Capacitor 的主视图控制器（Main.storyboard 用它）：注册 App 自带的原生插件。
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NeteaseHttpPlugin())
    }
}
