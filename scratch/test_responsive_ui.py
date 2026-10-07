import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_responsive"
artifact_dir = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9227",
    "--window-size=1280,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9227/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9227
    path = ws_url.split(f"{host}:{port}")[1]

    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((host, port))

    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(handshake.encode())
    resp = s.recv(4096).decode(errors='ignore')

    msg_id = 0

    def send_cdp(method, params=None):
        global msg_id
        msg_id += 1
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        
        data = payload.encode('utf-8')
        length = len(data)
        frame = bytearray([0x81])
        if length <= 125:
            frame.append(0x80 | length)
        elif length <= 65535:
            frame.append(0x80 | 126)
            frame.extend(length.to_bytes(2, 'big'))
        else:
            frame.append(0x80 | 127)
            frame.extend(length.to_bytes(8, 'big'))
        
        mask = os.urandom(4)
        frame.extend(mask)
        masked = bytearray(data[i] ^ mask[i % 4] for i in range(length))
        frame.extend(masked)
        s.sendall(frame)

        while True:
            header = s.recv(2)
            if len(header) < 2:
                continue
            b1, b2 = header[0], header[1]
            pay_len = b2 & 0x7F
            if pay_len == 126:
                pay_len = int.from_bytes(s.recv(2), 'big')
            elif pay_len == 127:
                pay_len = int.from_bytes(s.recv(8), 'big')
            
            raw = bytearray()
            while len(raw) < pay_len:
                chunk = s.recv(min(4096, pay_len - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            
            try:
                parsed = json.loads(raw.decode('utf-8', errors='ignore'))
                if parsed.get("id") == msg_id:
                    return parsed.get("result", {})
            except Exception:
                pass

    def eval_js(expr):
        res = send_cdp("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(out_path):
        res = send_cdp("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("data", "")
        if b64:
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(b64))
            print(f"Captured screenshot to: {out_path}")

    def set_viewport(w, h, is_mobile=False):
        send_cdp("Emulation.setDeviceMetricsOverride", {
            "width": w,
            "height": h,
            "deviceScaleFactor": 1,
            "mobile": is_mobile
        })
        time.sleep(0.3)

    # Let's inspect horizontal overflow check function
    check_overflow_js = """
    (() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const windowW = window.innerWidth;
        const overflow = scrollW > windowW;
        
        // Find elements spilling outside window
        const overflowingEls = [];
        const all = document.querySelectorAll('*');
        for (const el of all) {
            if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) continue;
            const rect = el.getBoundingClientRect();
            if (rect.right > windowW + 1.5 && el.offsetWidth > 0) {
                // Ignore elements that have overflow-x hidden parents or html/body
                if (el.tagName !== 'HTML' && el.tagName !== 'BODY') {
                    overflowingEls.push({
                        tag: el.tagName,
                        className: el.className || '',
                        id: el.id || '',
                        right: Math.round(rect.right),
                        windowW: windowW,
                        diff: Math.round(rect.right - windowW)
                    });
                }
            }
        }
        return {
            windowW,
            docW,
            scrollW,
            hasHorizontalScroll: overflow,
            overflowingEls: overflowingEls.slice(0, 10)
        };
    })()
    """

    viewports = [
        ("mobile_360", 360, 640, True),
        ("mobile_375", 375, 667, True),
        ("mobile_390", 390, 844, True),
        ("tablet_768", 768, 1024, False),
        ("laptop_1024", 1024, 768, False),
        ("desktop_1440", 1440, 900, False),
    ]

    time.sleep(2)

    for name, w, h, is_mob in viewports:
        print(f"\n================ Testing Viewport: {name} ({w}x{h}) ================")
        set_viewport(w, h, is_mob)

        # 1. Dashboard View
        eval_js("window.app.navigate('dashboard')")
        time.sleep(0.4)
        dash_check = eval_js(check_overflow_js)
        print(f"[{name}] Dashboard overflow: scrollW={dash_check.get('scrollW')} vs winW={dash_check.get('windowW')}, hasScroll={dash_check.get('hasHorizontalScroll')}")
        if dash_check.get('overflowingEls'):
            print(f"[{name}] Dashboard overflowing elements: {dash_check.get('overflowingEls')}")
        capture_screenshot(os.path.join(artifact_dir, f"responsive_{name}_dashboard.png"))

        # 2. Decks View
        eval_js("window.app.navigate('classes')")
        time.sleep(0.4)
        decks_check = eval_js(check_overflow_js)
        print(f"[{name}] Decks overflow: scrollW={decks_check.get('scrollW')} vs winW={decks_check.get('windowW')}, hasScroll={decks_check.get('hasHorizontalScroll')}")
        if decks_check.get('overflowingEls'):
            print(f"[{name}] Decks overflowing elements: {decks_check.get('overflowingEls')}")
        capture_screenshot(os.path.join(artifact_dir, f"responsive_{name}_decks.png"))

        # 3. Study View
        eval_js("window.app.navigate('study', { mode: 'daily' })")
        time.sleep(0.4)
        study_check = eval_js(check_overflow_js)
        print(f"[{name}] Study overflow: scrollW={study_check.get('scrollW')} vs winW={study_check.get('windowW')}, hasScroll={study_check.get('hasHorizontalScroll')}")
        if study_check.get('overflowingEls'):
            print(f"[{name}] Study overflowing elements: {study_check.get('overflowingEls')}")
        
        # Also flip the card to see rating buttons
        eval_js("document.getElementById('btn-show-answer')?.click()")
        time.sleep(0.3)
        study_back_check = eval_js(check_overflow_js)
        print(f"[{name}] Study Back overflow: scrollW={study_back_check.get('scrollW')} vs winW={study_back_check.get('windowW')}, hasScroll={study_back_check.get('hasHorizontalScroll')}")
        if study_back_check.get('overflowingEls'):
            print(f"[{name}] Study Back overflowing elements: {study_back_check.get('overflowingEls')}")
        capture_screenshot(os.path.join(artifact_dir, f"responsive_{name}_study_back.png"))

        # 4. Modals - Import Modal
        eval_js("window.app.navigate('classes')")
        time.sleep(0.2)
        eval_js("window.app.showImportModal()")
        time.sleep(0.4)
        import_check = eval_js(check_overflow_js)
        print(f"[{name}] Import Modal overflow: scrollW={import_check.get('scrollW')} vs winW={import_check.get('windowW')}, hasScroll={import_check.get('hasHorizontalScroll')}")
        if import_check.get('overflowingEls'):
            print(f"[{name}] Import Modal overflowing elements: {import_check.get('overflowingEls')}")
        capture_screenshot(os.path.join(artifact_dir, f"responsive_{name}_import_modal.png"))
        eval_js("document.querySelector('.modal-overlay')?.click() || document.querySelector('.btn-close')?.click()")
        time.sleep(0.2)

        # 5. Settings Modal
        eval_js("document.getElementById('nav-btn-settings')?.click()")
        time.sleep(0.4)
        settings_check = eval_js(check_overflow_js)
        print(f"[{name}] Settings Modal overflow: scrollW={settings_check.get('scrollW')} vs winW={settings_check.get('windowW')}, hasScroll={settings_check.get('hasHorizontalScroll')}")
        if settings_check.get('overflowingEls'):
            print(f"[{name}] Settings Modal overflowing elements: {settings_check.get('overflowingEls')}")
        capture_screenshot(os.path.join(artifact_dir, f"responsive_{name}_settings_modal.png"))
        eval_js("document.querySelector('.modal-overlay')?.click() || document.querySelector('.btn-close')?.click()")
        time.sleep(0.2)

    print("\nResponsive inspection completed successfully!")

finally:
    proc.kill()
