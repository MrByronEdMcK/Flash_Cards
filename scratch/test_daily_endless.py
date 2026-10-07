import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_daily_endless"
screenshot_dash = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_dashboard_daily_20.png"
screenshot_daily = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_study_daily_20.png"
screenshot_endless = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_study_endless_110.png"
screenshot_endless_flipped = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_endless_anki_ratings.png"
screenshot_decks_reset = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_decks_reset_button.png"

# Launch Chrome
proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9223",
    "--window-size=1280,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9223/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")
    print(f"WS URL: {ws_url}")

    host = "127.0.0.1"
    port = 9223
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
    if "101" not in resp:
        print("Handshake failed:", resp)
        exit(1)

    msg_id = 0

    def send_cdp(method, params=None):
        global msg_id
        msg_id += 1
        payload = json.dumps({"id": msg_id, "method": method, "params": params or {}})
        
        # Build WS frame
        data = payload.encode('utf-8')
        length = len(data)
        frame = bytearray([0x81]) # FIN + text opcode
        if length <= 125:
            frame.append(0x80 | length)
        elif length <= 65535:
            frame.append(0x80 | 126)
            frame.extend(length.to_bytes(2, 'big'))
        else:
            frame.append(0x80 | 127)
            frame.extend(length.to_bytes(8, 'big'))
        
        # Masking key
        mask = os.urandom(4)
        frame.extend(mask)
        # Mask data
        masked = bytearray(data[i] ^ mask[i % 4] for i in range(length))
        frame.extend(masked)
        s.sendall(frame)

        # Read responses until we find matching id
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

    # Step 1: Wait for app initialization and seed General Knowledge if needed
    print("Checking app initial state...")
    time.sleep(1.5)
    
    # Check dashboard elements
    hero_title = eval_js("document.querySelector('.hero-title')?.innerText")
    hero_daily_btn = eval_js("document.querySelector('#btn-start-daily')?.innerText")
    hero_endless_btn = eval_js("document.querySelector('#btn-start-endless-all')?.innerText")
    class_daily_btn = eval_js("document.querySelector('.btn-class-daily')?.innerText")
    class_endless_btn = eval_js("document.querySelector('.btn-class-endless')?.innerText")
    stat_due_num = eval_js("document.querySelectorAll('.stat-number')[1]?.innerText")

    print(f"Hero Title: {hero_title}")
    print(f"Hero Daily Button: {hero_daily_btn}")
    print(f"Hero Endless Button: {hero_endless_btn}")
    print(f"Class Daily Button: {class_daily_btn}")
    print(f"Class Endless Button: {class_endless_btn}")
    print(f"Stat Due Number: {stat_due_num}")

    capture_screenshot(screenshot_dash)

    # Step 2: Test Start Daily Review
    print("\n--- Testing Start Daily Review ---")
    eval_js("document.querySelector('#btn-start-daily').click()")
    time.sleep(1.0)

    daily_mode_pill = eval_js("document.querySelector('.study-mode-pill')?.innerText")
    daily_card_counter = eval_js("document.querySelector('.study-card-counter')?.innerText")
    print(f"Daily Study Mode Pill: {daily_mode_pill}")
    print(f"Daily Card Counter: {daily_card_counter}")
    capture_screenshot(screenshot_daily)

    # Step 3: Exit and Test Endless Practice
    print("\n--- Testing Endless Practice ---")
    eval_js("document.querySelector('#btn-exit-study').click()")
    time.sleep(1.0)

    eval_js("document.querySelector('#btn-start-endless-all').click()")
    time.sleep(1.0)

    endless_mode_pill = eval_js("document.querySelector('.study-mode-pill')?.innerText")
    endless_card_counter = eval_js("document.querySelector('.study-card-counter')?.innerText")
    print(f"Endless Study Mode Pill: {endless_mode_pill}")
    print(f"Endless Card Counter: {endless_card_counter}")
    capture_screenshot(screenshot_endless)

    # Flip the card
    eval_js("document.querySelector('#btn-flip-card').click()")
    time.sleep(0.5)

    # Check 4 Anki Rating buttons
    ratings_btns = eval_js("[...document.querySelectorAll('.btn-srs-rating')].map(b => b.innerText.replace(/\\n/g, ' '))")
    print(f"Endless Flipped Ratings Buttons: {ratings_btns}")
    capture_screenshot(screenshot_endless_flipped)

    # Step 4: Rate with Good [3] and verify next card
    print("\n--- Testing Anki Rating in Endless ---")
    eval_js("document.querySelector('.rating-good').click()")
    time.sleep(0.5)
    next_card_counter = eval_js("document.querySelector('.study-card-counter')?.innerText")
    print(f"After Rating Good, Card Counter: {next_card_counter}")

    # Step 5: Test Folders & Decks View Reset Button
    print("\n--- Testing Folders & Decks View Reset Button ---")
    eval_js("document.querySelector('#btn-exit-study')?.click()")
    time.sleep(0.5)
    eval_js("document.querySelector('.nav-link[data-view=\"decks\"]').click()")
    time.sleep(1.0)

    # Open the gear dropdown
    eval_js("document.querySelector('#btn-group-more').click()")
    time.sleep(0.5)

    reset_group_btn = eval_js("document.querySelector('#btn-reset-group-progress')?.innerText")
    reset_card_btns = eval_js("document.querySelectorAll('.btn-reset-card').length")
    safe_btn = str(reset_group_btn).encode('ascii', 'backslashreplace').decode('ascii')
    print(f"Dropdown Reset Button: {safe_btn}")
    print(f"Card Reset Buttons Count: {reset_card_btns}")
    capture_screenshot(screenshot_decks_reset)

    print("\nVerification script finished successfully!")

finally:
    proc.terminate()
