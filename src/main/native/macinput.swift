// macinput.swift — EAgent 原生输入/屏幕信息工具
// 编译: swiftc -O -o bin/macinput src/main/native/macinput.swift -framework Cocoa -framework CoreGraphics -framework ApplicationServices
//
// 子命令:
//   info                                    → JSON: 显示器/缩放/鼠标逻辑坐标/权限状态
//   mouse move <x> <y>                      → 移动光标
//   mouse click <x> <y> [left|right|middle] [--double]
//   mouse down|up [left|right|middle]
//   mouse scroll <dy> [dx]
//   key tap <name>                           → 单击按键 (return/tab/esc/cmd/...)
//   key combo <a+b+c>                        → 组合键 (cmd+shift+4)
//   key type <text>                          → 直接注入 Unicode 文本（中文/emoji 均可）
//   key hold <name> <ms>                     → 按住按键指定毫秒
//   activate <bundleId|appName>              → 激活应用窗口
//   windows                                  → 列出可截图的窗口 (id/title/bounds)

import Cocoa
import CoreGraphics
import ApplicationServices

// MARK: - 权限

func axTrusted() -> Bool { AXIsProcessTrusted() }

func screenCaptureAllowed() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return true
}

// MARK: - 键码表 (Carbon kVK_*)

let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05,
    "z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C,
    "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11,
    "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17,
    "equal": 0x18, "9": 0x19, "7": 0x1A, "minus": 0x1B, "8": 0x1C, "0": 0x1D,
    "rightbracket": 0x1E, "o": 0x1F, "u": 0x20, "leftbracket": 0x21,
    "i": 0x22, "p": 0x23, "return": 0x24, "enter": 0x24, "l": 0x25,
    "j": 0x26, "quote": 0x27, "k": 0x28, "semicolon": 0x29, "backslash": 0x2A,
    "comma": 0x2B, "slash": 0x2C, "n": 0x2D, "m": 0x2E, "period": 0x2F,
    "tab": 0x30, "space": 0x31, "grave": 0x32, "delete": 0x33, "backspace": 0x33,
    "escape": 0x35, "esc": 0x35, "capslock": 0x39,
    "command": 0x37, "cmd": 0x37, "shift": 0x38, "capslock2": 0x39,
    "option": 0x3A, "alt": 0x3A, "control": 0x3B, "ctrl": 0x3B,
    "rightshift": 0x3C, "rightoption": 0x3D, "rightcontrol": 0x3E,
    "function": 0x3F, "fn": 0x3F, "f17": 0x40, "volumeup": 0x48,
    "volumedown": 0x49, "mute": 0x4A, "f18": 0x4F, "f19": 0x50,
    "f20": 0x5A, "f5": 0x60, "f6": 0x61, "f7": 0x62, "f3": 0x63,
    "f8": 0x64, "f9": 0x65, "f11": 0x67, "f13": 0x69, "f16": 0x6A,
    "f14": 0x6B, "f10": 0x6D, "f12": 0x6F, "f15": 0x71, "help": 0x72,
    "home": 0x73, "pageup": 0x74, "forwarddelete": 0x75, "f4": 0x76,
    "end": 0x77, "pagedown": 0x79, "f1": 0x7A, "left": 0x7B,
    "right": 0x7C, "down": 0x7D, "up": 0x7E, "f2": 0x78,
]

let modifierFlags: [String: CGEventFlags] = [
    "cmd": .maskCommand, "command": .maskCommand,
    "shift": .maskShift,
    "alt": .maskAlternate, "option": .maskAlternate,
    "ctrl": .maskControl, "control": .maskControl,
    "fn": .maskSecondaryFn,
]

// MARK: - 输出

func fail(_ msg: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

func emit(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

// MARK: - 坐标

/// 主屏高度（逻辑点）——用于 NSEvent(左下原点) → CGEvent(左上原点) 翻转
func mainScreenHeight() -> Double {
    let m = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.screens.first
    return Double(m?.frame.height ?? 0)
}

/// 屏幕逻辑尺寸（排除菜单栏/Dock）
func visibleFrameOfMainScreen() -> NSRect {
    let m = NSScreen.screens.first { $0.frame.origin == .zero } ?? NSScreen.screens.first
    return m?.frame ?? .zero
}

func mouseLogicalTopLeft() -> (Double, Double) {
    let p = NSEvent.mouseLocation // 左下原点
    return (Double(p.x), mainScreenHeight() - Double(p.y))
}

// MARK: - 鼠标

func postMouse(_ type: CGEventType, _ pt: CGPoint, _ button: CGMouseButton, clickCount: Int64 = 1) {
    guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: button) else {
        fail("创建鼠标事件失败")
    }
    e.setIntegerValueField(.mouseEventClickState, value: clickCount)
    e.post(tap: .cghidEventTap)
}

func buttonParts(_ name: String) -> (CGMouseButton, CGEventType, CGEventType) {
    switch name {
    case "right":  return (.right, .rightMouseDown, .rightMouseUp)
    case "middle": return (.center, .otherMouseDown, .otherMouseUp)
    default:       return (.left, .leftMouseDown, .leftMouseUp)
    }
}

// MARK: - 键盘

func postKey(_ code: CGKeyCode, down: Bool, flags: CGEventFlags = []) {
    guard let e = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { return }
    if !flags.isEmpty { e.flags = flags }
    e.post(tap: .cghidEventTap)
}

func tapKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
    postKey(code, down: true, flags: flags)
    usleep(8000)
    postKey(code, down: false, flags: flags)
}

func typeText(_ text: String) {
    // 用 Unicode 字符串直接注入，不受键盘布局限制，中文/emoji 均可
    let utf16 = Array(text.utf16)
    guard !utf16.isEmpty else { return }
    let chunkSize = 20
    var idx = 0
    while idx < utf16.count {
        let end = min(idx + chunkSize, utf16.count)
        let slice = Array(utf16[idx..<end])
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
           let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            down.keyboardSetUnicodeString(stringLength: slice.count, unicodeString: slice)
            up.keyboardSetUnicodeString(stringLength: slice.count, unicodeString: slice)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
        idx = end
        usleep(4000)
    }
}

// MARK: - 窗口列表（供 screencapture -l 使用）

func listWindows() -> [[String: Any]] {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    var out: [[String: Any]] = []
    for w in info {
        guard let wid = w[kCGWindowNumber as String] as? Int,
              let owner = w[kCGWindowOwnerName as String] as? String else { continue }
        let name = (w[kCGWindowName as String] as? String) ?? ""
        var item: [String: Any] = ["id": wid, "app": owner, "title": name]
        if let b = w[kCGWindowBounds as String] as? [String: Any] {
            item["bounds"] = b
        }
        if let layer = w[kCGWindowLayer as String] as? Int, layer != 0 { continue }
        out.append(item)
    }
    return out
}

// MARK: - 命令分发

let args = Array(CommandLine.arguments.dropFirst())
guard let cmd = args.first else {
    fail("用法: macinput <info|mouse|key|activate|windows> ...")
}

switch cmd {
case "info":
    var displays: [[String: Any]] = []
    for (i, s) in NSScreen.screens.enumerated() {
        let f = s.frame
        let scale = Double(s.backingScaleFactor)
        displays.append([
            "index": i,
            "originX": Double(f.origin.x),
            "originY": Double(f.origin.y),
            "logicalWidth": Double(f.width),
            "logicalHeight": Double(f.height),
            "pixelWidth": Double(f.width) * scale,
            "pixelHeight": Double(f.height) * scale,
            "scale": scale,
            "name": s.localizedName,
        ])
    }
    let (mx, my) = mouseLogicalTopLeft()
    emit([
        "platform": "macos",
        "macosVersion": ProcessInfo.processInfo.operatingSystemVersionString,
        "displays": displays,
        "mainScreenHeight": mainScreenHeight(),
        "mouse": ["x": mx, "y": my],
        "coordinateSpace": "top-left origin, logical points (CGEvent global space)",
        "accessibilityTrusted": axTrusted(),
        "screenCaptureAllowed": screenCaptureAllowed(),
        "binaryPath": Bundle.main.executablePath ?? "",
    ])

case "windows":
    emit(["windows": listWindows()])

case "activate":
    guard args.count >= 2 else { fail("用法: macinput activate <bundleId|appName>") }
    let target = args[1]
    let apps = NSWorkspace.shared.runningApplications
    let hit = apps.first { $0.bundleIdentifier == target }
        ?? apps.first { ($0.localizedName ?? "").localizedCaseInsensitiveContains(target) }
    guard let app = hit else { fail("未找到应用: \(target)") }
    app.activate(options: [.activateAllWindows])
    print("OK \(app.localizedName ?? target) pid=\(app.processIdentifier)")

case "mouse":
    guard args.count >= 2 else { fail("用法: macinput mouse <move|click|down|up|scroll> ...") }
    let sub = args[1]
    switch sub {
    case "move":
        guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { fail("用法: mouse move <x> <y>") }
        postMouse(.mouseMoved, CGPoint(x: x, y: y), .left)
        print("OK move \(x),\(y)")
    case "click":
        guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { fail("用法: mouse click <x> <y> [left|right|middle] [--double]") }
        var btn = "left"
        var dbl = false
        for a in args.dropFirst(4) {
            if a == "--double" { dbl = true } else if ["left","right","middle"].contains(a) { btn = a }
        }
        let (button, downT, upT) = buttonParts(btn)
        let pt = CGPoint(x: x, y: y)
        postMouse(.mouseMoved, pt, button)
        usleep(15000)
        if dbl {
            postMouse(downT, pt, button, clickCount: 1); usleep(20000)
            postMouse(upT, pt, button, clickCount: 1); usleep(60000)
            postMouse(downT, pt, button, clickCount: 2); usleep(20000)
            postMouse(upT, pt, button, clickCount: 2)
        } else {
            postMouse(downT, pt, button); usleep(20000)
            postMouse(upT, pt, button)
        }
        print("OK click \(btn) \(x),\(y)\(dbl ? " double" : "")")
    case "down", "up":
        guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { fail("用法: mouse down|up <x> <y> [left|right|middle]") }
        let btn = args.count >= 5 ? args[4] : "left"
        let (button, downT, upT) = buttonParts(btn)
        postMouse(sub == "down" ? downT : upT, CGPoint(x: x, y: y), button)
        print("OK \(sub) \(btn) \(x),\(y)")
    case "scroll":
        guard args.count >= 3, let dy = Int32(args[2]) else { fail("用法: mouse scroll <dy> [dx]") }
        let dx = args.count >= 4 ? (Int32(args[3]) ?? 0) : 0
        if let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) {
            e.post(tap: .cghidEventTap)
        }
        print("OK scroll dy=\(dy) dx=\(dx)")
    default:
        fail("未知 mouse 子命令: \(sub)")
    }

case "key":
    guard args.count >= 2 else { fail("用法: macinput key <tap|combo|type|hold> ...") }
    let sub = args[1]
    switch sub {
    case "tap":
        guard args.count >= 3 else { fail("用法: key tap <name>") }
        let name = args[2].lowercased()
        if let code = keyCodes[name] { tapKey(code); print("OK tap \(name)") }
        else if let num = UInt16(args[2]) { tapKey(CGKeyCode(num)); print("OK tap keycode \(num)") }
        else { fail("未知键名: \(name)") }
    case "combo":
        guard args.count >= 3 else { fail("用法: key combo cmd+shift+4") }
        let parts = args[2].lowercased().split(separator: "+").map(String.init)
        guard let last = parts.last else { fail("组合键为空") }
        var flags: CGEventFlags = []
        for p in parts.dropLast() {
            guard let f = modifierFlags[p] else { fail("未知修饰键: \(p)") }
            flags.insert(f)
        }
        let code: CGKeyCode
        if let c = keyCodes[last] { code = c }
        else if let num = UInt16(last) { code = CGKeyCode(num) }
        else { fail("未知键名: \(last)") }
        tapKey(code, flags: flags)
        print("OK combo \(args[2])")
    case "type":
        guard args.count >= 3 else { fail("用法: key type <text>") }
        let text = args.dropFirst(2).joined(separator: " ")
        typeText(text)
        print("OK type \(text.count) chars")
    case "hold":
        guard args.count >= 4, let ms = UInt32(args[3]) else { fail("用法: key hold <name> <ms>") }
        let name = args[2].lowercased()
        guard let code = keyCodes[name] else { fail("未知键名: \(name)") }
        postKey(code, down: true)
        usleep(ms * 1000)
        postKey(code, down: false)
        print("OK hold \(name) \(ms)ms")
    default:
        fail("未知 key 子命令: \(sub)")
    }

default:
    fail("未知命令: \(cmd)")
}
