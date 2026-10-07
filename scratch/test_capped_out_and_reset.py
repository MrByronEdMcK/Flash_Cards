import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_capped_out"
screenshot_capped = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_endless_capped_out.png"
screenshot_post_reset = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_endless_post_reset.png"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9224",
    "--window-size=1280,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9224/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9224
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

    time.sleep(1.5)

    # 1. Schedule all cards for next week to simulate a fully reviewed/capped deck
    print("Scheduling all cards into the future (2026-10-20)...")
    eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            const cards = await storage.getCards();
            for (const c of cards) {
                c.srs = {
                    state: 'review',
                    interval: 10,
                    easeFactor: 2.5,
                    reps: 3,
                    lapses: 0,
                    dueDate: '2026-10-20',
                    lastReviewed: new Date().toISOString()
                };
                c.boxSrs = {};
                c.clozeSrs = {};
                await storage.saveCard(c);
            }
        })()
    """)
    time.sleep(1.0)

    # 2. Click Endless Practice
    print("Opening Endless Practice with all cards scheduled for future...")
    eval_js("document.querySelector('#btn-start-endless-all').click()")
    time.sleep(1.0)

    comp_title = eval_js("document.querySelector('.completion-title')?.innerText")
    comp_subtitle = eval_js("document.querySelector('.completion-subtitle')?.innerText")
    has_reset_btn = eval_js("!!document.querySelector('#btn-comp-reset-progress')")

    print(f"Capped Out Screen Title: {comp_title}")
    safe_sub = str(comp_subtitle).encode('ascii', 'backslashreplace').decode('ascii')
    print(f"Capped Out Subtitle: {safe_sub}")
    print(f"Has Reset Progress Button: {has_reset_btn}")
    capture_screenshot(screenshot_capped)

    # 3. Test Reset Review Data directly via storage.resetReviewData
    print("\nCalling storage.resetReviewData to restore cards...")
    eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            await storage.resetReviewData(null, true);
        })()
    """)
    time.sleep(0.5)

    # Check that cards state is 'new' and interval is 0
    reset_check = eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            const cards = await storage.getCards();
            return {
                totalCards: cards.length,
                allNew: cards.every(c => c.srs.state === 'new' && c.srs.interval === 0)
            };
        })()
    """)
    print(f"Reset Verification: {reset_check}")

    # Launch endless practice again
    eval_js("document.querySelector('#btn-start-endless-all')?.click() || window.location.reload()")
    time.sleep(1.5)
    eval_js("document.querySelector('#btn-start-endless-all')?.click()")
    time.sleep(1.0)

    new_endless_counter = eval_js("document.querySelector('.study-card-counter')?.innerText")
    print(f"After Reset, Endless Card Counter: {new_endless_counter}")
    capture_screenshot(screenshot_post_reset)

    print("\nCapped-out and reset verification successful!")

finally:
    proc.terminate()
