import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_verify_resp_all"
artifact_dir = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9235",
    "--window-size=1600,1000",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9235/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9235
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
    s.recv(4096)

    msg_id = 0

    def send_cdp(method, params=None):
        global msg_id
        msg_id += 1
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        data = payload.encode('utf-8')
        length = len(data)
        frame = bytearray([0x81])
        if length <= 125: frame.append(0x80 | length)
        elif length <= 65535: frame.append(0x80 | 126); frame.extend(length.to_bytes(2, 'big'))
        else: frame.append(0x80 | 127); frame.extend(length.to_bytes(8, 'big'))
        mask = os.urandom(4)
        frame.extend(mask)
        frame.extend(bytearray(data[i] ^ mask[i % 4] for i in range(length)))
        s.sendall(frame)

        while True:
            header = s.recv(2)
            if len(header) < 2: continue
            b1, b2 = header[0], header[1]
            pay_len = b2 & 0x7F
            if pay_len == 126: pay_len = int.from_bytes(s.recv(2), 'big')
            elif pay_len == 127: pay_len = int.from_bytes(s.recv(8), 'big')
            raw = bytearray()
            while len(raw) < pay_len:
                chunk = s.recv(min(4096, pay_len - len(raw)))
                if not chunk: break
                raw.extend(chunk)
            try:
                parsed = json.loads(raw.decode('utf-8', errors='ignore'))
                if parsed.get("id") == msg_id: return parsed.get("result", {})
            except Exception: pass

    def eval_js(expr):
        res = send_cdp("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return res.get("result", {}).get("value")

    def capture_screenshot(out_path):
        res = send_cdp("Page.captureScreenshot", {"format": "png"})
        b64 = res.get("data", "")
        if b64:
            with open(out_path, "wb") as f:
                f.write(base64.b64decode(b64))

    def set_viewport(w, h, mobile=False):
        send_cdp("Emulation.setDeviceMetricsOverride", {
            "width": w,
            "height": h,
            "deviceScaleFactor": 1,
            "mobile": mobile
        })
        time.sleep(0.3)

    check_overflow_js = """
    (() => {
        const winW = window.innerWidth;
        const scrollW = document.documentElement.scrollWidth;
        const docW = document.documentElement.clientWidth;
        const hasHorizontalScroll = scrollW > winW;
        
        const leaking = [];
        document.querySelectorAll('header, nav, main, section, div, button, table, form, input, h1, h2, h3, h4, p').forEach(el => {
            if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) return;
            
            // Exclude deliberate scroll containers
            let isInsideScroll = false;
            let p = el.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
                const cs = window.getComputedStyle(p);
                if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'hidden') {
                    isInsideScroll = true;
                    break;
                }
                p = p.parentElement;
            }
            if (!isInsideScroll) {
                const r = el.getBoundingClientRect();
                if (r.right > winW + 1.5) {
                    leaking.push({
                        tag: el.tagName,
                        id: el.id,
                        className: (el.className || '').toString().slice(0, 40),
                        right: Math.round(r.right),
                        diff: Math.round(r.right - winW)
                    });
                }
            }
        });

        return {
            winW,
            docW,
            scrollW,
            hasHorizontalScroll,
            leakingCount: leaking.length,
            leaking: leaking.slice(0, 5)
        };
    })()
    """

    viewports = [
        ("Mobile_360", 360, 640, True),
        ("Mobile_375", 375, 667, True),
        ("Mobile_390", 390, 844, True),
        ("Tablet_768", 768, 1024, False),
        ("Laptop_1024", 1024, 768, False),
        ("Desktop_1440", 1440, 900, False),
    ]

    time.sleep(1.0)
    all_passed = True

    for vp_name, w, h, mob in viewports:
        print(f"\n=======================================================")
        print(f" TESTING VIEWPORT: {vp_name} ({w}x{h}, mobile={mob})")
        print(f"=======================================================")
        set_viewport(w, h, mob)

        # 1. Test Dashboard
        eval_js("window.app.navigate('dashboard')")
        time.sleep(0.3)
        res_dash = eval_js(check_overflow_js)
        print(f" [Dashboard] winW={res_dash.get('winW')} scrollW={res_dash.get('scrollW')} hasScroll={res_dash.get('hasHorizontalScroll')} leaks={res_dash.get('leakingCount')}")
        if res_dash.get('hasHorizontalScroll') or res_dash.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_dash.get('leaking')}")
        capture_screenshot(os.path.join(artifact_dir, f"verified_{vp_name.lower()}_dashboard.png"))

        # 2. Test Decks
        eval_js("window.app.navigate('decks')")
        time.sleep(0.3)
        res_decks = eval_js(check_overflow_js)
        print(f" [Decks] winW={res_decks.get('winW')} scrollW={res_decks.get('scrollW')} hasScroll={res_decks.get('hasHorizontalScroll')} leaks={res_decks.get('leakingCount')}")
        if res_decks.get('hasHorizontalScroll') or res_decks.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_decks.get('leaking')}")
        capture_screenshot(os.path.join(artifact_dir, f"verified_{vp_name.lower()}_decks.png"))

        # 3. Test Study Front
        eval_js("window.app.navigate('study', { mode: 'daily' })")
        time.sleep(0.3)
        res_study_front = eval_js(check_overflow_js)
        print(f" [Study Front] winW={res_study_front.get('winW')} scrollW={res_study_front.get('scrollW')} hasScroll={res_study_front.get('hasHorizontalScroll')} leaks={res_study_front.get('leakingCount')}")
        if res_study_front.get('hasHorizontalScroll') or res_study_front.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_study_front.get('leaking')}")

        # 4. Test Study Back (Flip card)
        eval_js("document.getElementById('btn-show-answer')?.click()")
        time.sleep(0.3)
        res_study_back = eval_js(check_overflow_js)
        print(f" [Study Back] winW={res_study_back.get('winW')} scrollW={res_study_back.get('scrollW')} hasScroll={res_study_back.get('hasHorizontalScroll')} leaks={res_study_back.get('leakingCount')}")
        if res_study_back.get('hasHorizontalScroll') or res_study_back.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_study_back.get('leaking')}")
        capture_screenshot(os.path.join(artifact_dir, f"verified_{vp_name.lower()}_study_back.png"))

        # 5. Test Import Modal
        eval_js("window.app.navigate('decks')")
        time.sleep(0.2)
        eval_js("window.app.modals.openImportExportModal({})")
        time.sleep(0.3)
        res_import = eval_js(check_overflow_js)
        print(f" [Import Modal] winW={res_import.get('winW')} scrollW={res_import.get('scrollW')} hasScroll={res_import.get('hasHorizontalScroll')} leaks={res_import.get('leakingCount')}")
        if res_import.get('hasHorizontalScroll') or res_import.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_import.get('leaking')}")
        capture_screenshot(os.path.join(artifact_dir, f"verified_{vp_name.lower()}_import_modal.png"))
        eval_js("document.getElementById('import-export-modal')?.classList.add('hidden')")
        time.sleep(0.2)

        # 6. Test Settings Modal
        eval_js("window.app.modals.openSettingsModal()")
        time.sleep(0.3)
        res_settings = eval_js(check_overflow_js)
        print(f" [Settings Modal] winW={res_settings.get('winW')} scrollW={res_settings.get('scrollW')} hasScroll={res_settings.get('hasHorizontalScroll')} leaks={res_settings.get('leakingCount')}")
        if res_settings.get('hasHorizontalScroll') or res_settings.get('leakingCount') > 0:
            all_passed = False
            print(f"   --> LEAK DETECTED: {res_settings.get('leaking')}")
        capture_screenshot(os.path.join(artifact_dir, f"verified_{vp_name.lower()}_settings_modal.png"))
        eval_js("document.getElementById('settings-modal')?.classList.add('hidden')")
        time.sleep(0.2)

    print(f"\nOVERALL RESULT: {'ALL TESTS PASSED WITH ZERO LEAKS / OVERFLOWS!' if all_passed else 'SOME LEAKS DETECTED'}")

finally:
    proc.kill()
