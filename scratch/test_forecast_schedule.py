import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_forecast_session"
screenshot_dashboard = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\forecast_dashboard_verified.png"
screenshot_tooltip = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\forecast_tooltip_verified.png"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9222",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2)
    req = urllib.request.urlopen("http://127.0.0.1:9222/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9222
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

    def send_cdp(cmd_id, method, params=None):
        msg = {"id": cmd_id, "method": method}
        if params:
            msg["params"] = params
        data = json.dumps(msg).encode()
        mask_key = os.urandom(4)
        length = len(data)
        header = bytearray([0x81])
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 65535:
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, 'big'))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, 'big'))
        header.extend(mask_key)
        masked_data = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(data))
        s.sendall(header + masked_data)

    def recv_cdp_until_id(target_id):
        buffer = bytearray()
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buffer.extend(chunk)
            while len(buffer) >= 2:
                first = buffer[0]
                second = buffer[1]
                payload_len = second & 0x7f
                offset = 2
                if payload_len == 126:
                    if len(buffer) < 4:
                        break
                    payload_len = int.from_bytes(buffer[2:4], 'big')
                    offset = 4
                elif payload_len == 127:
                    if len(buffer) < 10:
                        break
                    payload_len = int.from_bytes(buffer[2:10], 'big')
                    offset = 10
                if len(buffer) < offset + payload_len:
                    break
                payload = buffer[offset:offset + payload_len]
                buffer = buffer[offset + payload_len:]
                try:
                    obj = json.loads(payload.decode('utf-8'))
                    if obj.get("id") == target_id:
                        return obj
                except Exception:
                    pass

    send_cdp(1, "Runtime.enable")
    time.sleep(0.5)

    # 1. Switch to Dashboard and check data
    script_check = """(async () => {
        const navBtn = document.querySelector('[data-view="dashboard"]');
        if (navBtn) navBtn.click();
        await new Promise(r => setTimeout(r, 600));

        const cols = Array.from(document.querySelectorAll('.chart-day-col')).map(el => ({
            dayNum: el.dataset.dayNum,
            status: el.dataset.status,
            newCount: parseInt(el.dataset.new || '0', 10),
            reviewCount: parseInt(el.dataset.review || '0', 10),
            totalCount: parseInt(el.dataset.total || '0', 10),
            isToday: el.dataset.isToday === 'true'
        }));

        const totalNewIntroduced = cols.reduce((sum, c) => sum + c.newCount, 0);

        const metrics = Array.from(document.querySelectorAll('.forecast-metric-item')).map(el => ({
            val: el.querySelector('.forecast-metric-val')?.textContent.trim(),
            lbl: el.querySelector('.forecast-metric-lbl')?.textContent.trim()
        }));

        return { cols, totalNewIntroduced, metrics };
    })()"""
    send_cdp(2, "Runtime.evaluate", {"expression": script_check, "awaitPromise": True, "returnByValue": True})
    check_resp = recv_cdp_until_id(2)
    val = check_resp.get("result", {}).get("result", {}).get("value", {})
    print("Metrics:", json.dumps(val.get("metrics"), indent=2))
    print("Total New Cards in 30-day forecast:", val.get("totalNewIntroduced"))

    cols = val.get("cols", [])
    today_idx = next((i for i, c in enumerate(cols) if c.get("isToday")), -1)
    print("First 8 days from today:")
    for c in cols[today_idx : today_idx + 8]:
        print(f"  {c['status']}: New={c['newCount']}, Reviews={c['reviewCount']}, Total={c['totalCount']}")

    # 2. Hover over day +1 (Tomorrow) and inspect the floating tooltip
    script_hover = """(async () => {
        const cols = document.querySelectorAll('.chart-day-col');
        const todayColIdx = Array.from(cols).findIndex(el => el.dataset.isToday === 'true');
        const targetCol = cols[todayColIdx + 1]; // Tomorrow

        targetCol.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await new Promise(r => setTimeout(r, 200));

        const tooltip = document.querySelector('#forecast-floating-tooltip');
        const rect = tooltip ? tooltip.getBoundingClientRect() : null;
        const sectionRect = document.querySelector('.forecast-calendar-section')?.getBoundingClientRect();

        return {
            visible: tooltip && tooltip.style.display !== 'none',
            html: tooltip ? tooltip.innerHTML : '',
            rect: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
            sectionTop: sectionRect ? sectionRect.top : null,
            clippedAtTop: rect && sectionRect ? (rect.top < sectionRect.top) : false
        };
    })()"""
    send_cdp(3, "Runtime.evaluate", {"expression": script_hover, "awaitPromise": True, "returnByValue": True})
    hover_resp = recv_cdp_until_id(3)
    hover_val = hover_resp.get("result", {}).get("result", {}).get("value", {})
    print("Tooltip Hover Result:", json.dumps(hover_val, indent=2))

    # 3. Capture screenshots
    send_cdp(4, "Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
    shot_resp = recv_cdp_until_id(4)
    if shot_resp and "result" in shot_resp and "data" in shot_resp["result"]:
        img_data = base64.b64decode(shot_resp["result"]["data"])
        with open(screenshot_tooltip, "wb") as f:
            f.write(img_data)
        print(f"Saved tooltip screenshot ({len(img_data)} bytes)")

    s.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()
