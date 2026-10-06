import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_icon_test_session"
screenshot_out = r"C:\Users\charl\.gemini\antigravity\brain\7d545240-b32a-4dd7-974e-f3966d53d295\settings_icon_render.png"

# Create a test HTML file with the exact SVG
html_content = """<!DOCTYPE html>
<html>
<head>
<style>
body { background: #fdfbf7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.btn-icon { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #ddd; border-radius: 8px; color: #444; }
</style>
</head>
<body>
  <div class="btn-icon">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
  </div>
</body>
</html>"""

with open('scratch/test_svg.html', 'w', encoding='utf-8') as f:
    f.write(html_content)

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9222",
    "http://localhost:8080/scratch/test_svg.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2)
    req = urllib.request.urlopen("http://127.0.0.1:9222/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "test_svg.html" in p.get("url", "")), pages[0])
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

    send_cdp(2, "Page.captureScreenshot", {"format": "png"})
    shot_resp = recv_cdp_until_id(2)
    if shot_resp and "result" in shot_resp and "data" in shot_resp["result"]:
        img_data = base64.b64decode(shot_resp["result"]["data"])
        with open(screenshot_out, "wb") as f:
            f.write(img_data)
        print(f"Saved test SVG screenshot ({len(img_data)} bytes)")

    s.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except Exception:
        proc.kill()
