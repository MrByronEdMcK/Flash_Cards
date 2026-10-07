import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_diag_resp"
artifact_dir = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9232",
    "--window-size=1200,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9232/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9232
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

    # Enable Emulation and set screen size via Emulation.setDeviceMetricsOverride
    def set_screen_size(w, h, mobile=True):
        send_cdp("Emulation.setDeviceMetricsOverride", {
            "width": w,
            "height": h,
            "deviceScaleFactor": 1,
            "mobile": mobile
        })
        # also set visible size
        send_cdp("Emulation.setVisibleSize", {"width": w, "height": h})
        time.sleep(0.3)

    find_overflow_elements_js = """
    (() => {
        const winW = window.innerWidth;
        const culprits = [];
        const all = document.querySelectorAll('header, nav, main, section, div, button, table, form, input');
        
        for (const el of all) {
            if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) continue;
            // Check if element has horizontal overflow beyond winW
            const rect = el.getBoundingClientRect();
            
            // Check if element is inside an intentional scroll container (like .chart-scroll-wrapper, table-container)
            let isInsideScroll = false;
            let cur = el.parentElement;
            while (cur && cur !== document.body && cur !== document.documentElement) {
                const cs = window.getComputedStyle(cur);
                if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
                    isInsideScroll = true;
                    break;
                }
                cur = cur.parentElement;
            }

            if (!isInsideScroll && rect.right > winW + 1.5) {
                culprits.push({
                    tag: el.tagName,
                    id: el.id || '',
                    class: (el.className || '').toString().slice(0, 50),
                    right: Math.round(rect.right),
                    width: Math.round(rect.width),
                    overflowBy: Math.round(rect.right - winW)
                });
            }
        }
        return {
            windowInnerWidth: window.innerWidth,
            docClientWidth: document.documentElement.clientWidth,
            docScrollWidth: document.documentElement.scrollWidth,
            hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth,
            culpritCount: culprits.length,
            topCulprits: culprits.slice(0, 15)
        };
    })()
    """

    viewports = [
        ("Mobile 360", 360, 740, True),
        ("Mobile 375", 375, 667, True),
        ("Mobile 414", 414, 896, True),
        ("Tablet 768", 768, 1024, False),
        ("Laptop 1024", 1024, 768, False),
        ("Desktop 1440", 1440, 900, False),
    ]

    views = [
        ("Dashboard", "window.app.navigate('dashboard')"),
        ("Folders & Decks", "window.app.navigate('classes')"),
        ("Study View", "window.app.navigate('study', { mode: 'daily' })")
    ]

    for vp_name, w, h, mob in viewports:
        print(f"\n==================== {vp_name} ({w}x{h}) ====================")
        set_screen_size(w, h, mob)

        for view_name, nav_code in views:
            eval_js(nav_code)
            time.sleep(0.4)
            data = eval_js(find_overflow_elements_js)
            has_scroll = data.get('hasHorizontalScroll')
            scrollW = data.get('docScrollWidth')
            winW = data.get('windowInnerWidth')
            print(f"[{view_name}] winW={winW}, scrollW={scrollW}, hasHorizontalScroll={has_scroll}")
            if has_scroll or data.get('culpritCount', 0) > 0:
                print(f"  --> Culprits ({data.get('culpritCount')} total):")
                for c in data.get('topCulprits', []):
                    print(f"      {c['tag']} #{c['id']} .{c['class']} (right={c['right']}, width={c['width']}, overflowBy={c['overflowBy']}px)")
            
            slug = f"{vp_name.lower().replace(' ', '_')}_{view_name.lower().replace(' ', '_').replace('&', 'and')}"
            capture_screenshot(os.path.join(artifact_dir, f"diag_{slug}.png"))

finally:
    proc.kill()
