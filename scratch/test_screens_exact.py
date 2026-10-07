import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_responsive_nav"

def test_screen(w, h):
    proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--disable-gpu",
        "--incognito",
        "--disable-cache",
        f"--user-data-dir={user_data}_{w}",
        "--remote-debugging-port=9228",
        f"--window-size={w},{h}",
        "http://localhost:8080/index.html"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        time.sleep(2.0)
        req = urllib.request.urlopen("http://127.0.0.1:9228/json")
        pages = json.loads(req.read().decode())
        target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
        ws_url = target_page.get("webSocketDebuggerUrl")

        host = "127.0.0.1"
        port = 9228
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
            nonlocal msg_id
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

        # Check document width and window width
        check = eval_js("""
        (() => {
            return {
                windowInnerWidth: window.innerWidth,
                windowInnerHeight: window.innerHeight,
                docClientWidth: document.documentElement.clientWidth,
                docScrollWidth: document.documentElement.scrollWidth,
                bodyScrollWidth: document.body.scrollWidth,
                hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
                navRect: document.querySelector('.nav-container')?.getBoundingClientRect(),
                heroRect: document.querySelector('.hero-banner')?.getBoundingClientRect(),
                forecastCardRect: document.querySelector('.dashboard-card:nth-of-type(2)')?.getBoundingClientRect(),
            };
        })()
        """)
        print(f"Screen {w}x{h}:", check)
        artifact_path = f"C:\\Users\\charl\\.gemini\\antigravity\\brain\\7d545240-b32a-4dd7-974e-f3966d53d295\\check_{w}.png"
        capture_screenshot(artifact_path)
    finally:
        proc.kill()

for w, h in [(360, 740), (375, 667), (414, 896), (768, 1024), (1024, 768), (1440, 900)]:
    test_screen(w, h)
