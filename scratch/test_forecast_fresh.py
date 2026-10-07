import urllib.request
import json
import time
import socket
import base64
import os
import subprocess
import shutil

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = f"C:\\Users\\charl\\AppData\\Local\\Temp\\chrome_fresh_forecast_{int(time.time())}"
port = 9260

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    f"--user-data-dir={user_data}",
    f"--remote-debugging-port={port}",
    "--window-size=1200,900",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(3)
    req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json")
    pages = json.loads(req.read().decode())
    target = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target.get("webSocketDebuggerUrl")
    
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    host, p_num = "127.0.0.1", port
    path = ws_url.split(f"{host}:{p_num}")[1]
    s.connect((host, p_num))
    
    key = base64.b64encode(os.urandom(16)).decode()
    handshake = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{p_num}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(handshake.encode())
    s.recv(4096)

    def send_cdp(cmd_id, method, params=None):
        msg = {"id": cmd_id, "method": method}
        if params: msg["params"] = params
        data = json.dumps(msg).encode()
        mask_key = os.urandom(4)
        length = len(data)
        header = bytearray([0x81])
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 65535:
            header.append(0x80 | 126)
            header.extend(length.to_bytes(2, "big"))
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, "big"))
        header.extend(mask_key)
        masked = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(data))
        s.sendall(header + masked)

    def recv_cdp(target_id):
        buf = bytearray()
        while True:
            chunk = s.recv(65536)
            if not chunk: break
            buf.extend(chunk)
            while len(buf) >= 2:
                payload_len = buf[1] & 0x7f
                offset = 2
                if payload_len == 126:
                    if len(buf) < 4: break
                    payload_len = int.from_bytes(buf[2:4], "big")
                    offset = 4
                elif payload_len == 127:
                    if len(buf) < 10: break
                    payload_len = int.from_bytes(buf[2:10], "big")
                    offset = 10
                if len(buf) < offset + payload_len: break
                payload = buf[offset:offset+payload_len]
                buf = buf[offset+payload_len:]
                try:
                    obj = json.loads(payload.decode("utf-8"))
                    if obj.get("id") == target_id: return obj
                except: pass

    send_cdp(1, "Runtime.enable")
    time.sleep(1.5)

    eval_script = """
    (() => {
        const pastMetric = document.querySelector('.forecast-metric-val');
        const forecastBars = Array.from(document.querySelectorAll('.forecast-bar-track')).map((track, i) => {
            const newBar = track.querySelector('.bar-new');
            const revBar = track.querySelector('.bar-review');
            const newH = newBar ? newBar.style.height : '0%';
            const revH = revBar ? revBar.style.height : '0%';
            return { index: i, newHeight: newH, reviewHeight: revH };
        });
        return {
            past5CompletedText: pastMetric ? pastMetric.textContent.trim() : null,
            first5Tracks: forecastBars.slice(0, 5) // days -5 to -1
        };
    })()
    """
    send_cdp(2, "Runtime.evaluate", {"expression": eval_script, "returnByValue": True})
    res = recv_cdp(2)
    print("Forecast evaluation on fresh load:", json.dumps(res.get("result", {}).get("result", {}).get("value"), indent=2))

    send_cdp(3, "Page.captureScreenshot", {"format": "png"})
    shot = recv_cdp(3)
    if shot and "result" in shot and "data" in shot["result"]:
        with open("scratch/fresh_forecast.png", "wb") as f:
            f.write(base64.b64decode(shot["result"]["data"]))
        print("Screenshot saved to scratch/fresh_forecast.png")

    s.close()
finally:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except:
        proc.kill()
    try:
        shutil.rmtree(user_data, ignore_errors=True)
    except:
        pass
