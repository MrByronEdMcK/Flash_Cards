import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_two_goods_step2"
screenshot_step1 = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_step1_good_10m.png"
screenshot_step2_front = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_step2_badge_front.png"
screenshot_step2_back = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\verify_step2_1day_back.png"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9226",
    "--window-size=1280,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9226/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9226
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

    # Create a single test card in a test group to study isolated 2-step graduation
    print("Setting up single-card study session...")
    eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            const { createCard } = await import('./js/models.js');
            const groups = await storage.getGroups();
            const targetGroup = groups[0];
            
            // Create a brand new card
            const testCard = createCard({
                front: 'What planet is known as the Red Planet?',
                back: 'Mars',
                groupId: targetGroup.id,
                type: 'basic'
            });
            await storage.saveCard(testCard);
            window.__testCardId = testCard.id;
        })()
    """)
    time.sleep(0.5)

    # Launch StudyView with just this card
    eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            const card = await storage.getCard(window.__testCardId);
            // Launch studyView on this single card
            const appMain = document.getElementById('app-main');
            const { StudyView } = await import('./js/ui/studyView.js');
            const sv = new StudyView(appMain, () => {});
            sv.session = {
                mode: 'daily',
                groupId: card.groupId,
                groupName: 'Test Deck',
                cards: [card],
                currentIndex: 0,
                isFlipped: false,
                isHintRevealed: false,
                isReverseQuestion: false,
                stats: { total: 1, again: 0, hard: 0, good: 0, easy: 0, startTime: Date.now() }
            };
            sv._renderCurrentCard();
            sv._attachKeyListeners();
            window.__activeSv = sv;
        })()
    """)
    time.sleep(1.0)

    # 1. First review: Step 1
    counter1 = eval_js("document.querySelector('.study-card-counter')?.innerText")
    print(f"Initial Card Counter: {counter1}")

    # Flip card
    eval_js("window.__activeSv._flipCard()")
    time.sleep(0.5)

    good_pred_step1 = eval_js("document.querySelector('.rating-good .rating-interval')?.innerText")
    print(f"Step 1 Good Button Prediction: {good_pred_step1}")
    capture_screenshot(screenshot_step1)
    assert good_pred_step1 == '< 10m', f"Expected < 10m on step 1, got {good_pred_step1}"

    # Rate Good (1st Good in a row)
    print("\nRating Good [3] for the 1st time...")
    eval_js("window.__activeSv._handleRating(3)")
    time.sleep(0.5)

    # 2. The card was re-queued! It is now shown again (Card 2 of 2)
    counter2 = eval_js("document.querySelector('.study-card-counter')?.innerText")
    badge_step2 = eval_js("document.querySelector('.badge-step-learning')?.innerText")
    print(f"Step 2 Card Counter: {counter2}")
    safe_b_front = str(badge_step2).encode('ascii', 'backslashreplace').decode('ascii')
    print(f"Step 2 Learning Badge on Front: {safe_b_front}")
    capture_screenshot(screenshot_step2_front)
    assert badge_step2 == '⭐ 1 of 2 Good', f"Expected badge '⭐ 1 of 2 Good', got {badge_step2}"

    # Flip card on Step 2
    eval_js("window.__activeSv._flipCard()")
    time.sleep(0.5)

    good_pred_step2 = eval_js("document.querySelector('.rating-good .rating-interval')?.innerText")
    badge_step2_back = eval_js("document.querySelector('.badge-step-learning')?.innerText")
    safe_b_back = str(badge_step2_back).encode('ascii', 'backslashreplace').decode('ascii')
    print(f"Step 2 Good Button Prediction: {good_pred_step2}")
    print(f"Step 2 Learning Badge on Back: {safe_b_back}")
    capture_screenshot(screenshot_step2_back)
    assert good_pred_step2 == '1 day', f"Expected '1 day' on step 2, got {good_pred_step2}"

    # Rate Good (2nd Good in a row -> GRADUATES!)
    print("\nRating Good [3] for the 2nd time (should graduate!)...")
    eval_js("window.__activeSv._handleRating(3)")
    time.sleep(0.5)

    comp_title = eval_js("document.querySelector('.completion-title')?.innerText")
    print(f"Completion Title after 2nd Good: {comp_title}")

    # Verify card in storage has interval 1 and dueDate tomorrow
    saved_card_srs = eval_js("""
        (async () => {
            const { storage } = await import('./js/storage.js');
            const card = await storage.getCard(window.__testCardId);
            return card.srs;
        })()
    """)
    print(f"Final Saved SRS in Storage: {json.dumps(saved_card_srs, indent=2)}")
    assert saved_card_srs['interval'] == 1, f"Expected interval 1, got {saved_card_srs['interval']}"
    assert saved_card_srs['state'] == 'review', f"Expected state 'review', got {saved_card_srs['state']}"
    assert saved_card_srs['consecutiveGoods'] == 0, f"Expected consecutiveGoods 0, got {saved_card_srs['consecutiveGoods']}"

    print("\n>>> All 2-Good graduation requirements 100% verified! <<<")

finally:
    proc.terminate()
