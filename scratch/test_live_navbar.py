import urllib.request
import json
import time
import socket
import base64
import os
import subprocess
import shutil

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
widths = [1200, 950, 820, 650]

for w in widths:
    user_data = f"C:\\Users\\charl\\AppData\\Local\\Temp\\chrome_fresh_{w}_{int(time.time())}"
    port = 9250 + (w % 40)
    proc = subprocess.Popen([
        chrome_path,
        "--headless=new",
        "--disable-gpu",
        "--incognito",
        f"--user-data-dir={user_data}",
        f"--remote-debugging-port={port}",
        f"--window-size={w},750",
        "http://localhost:8080/index.html"
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        time.sleep(2.5)
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
        time.sleep(1)

        eval_code = """
        (() => {
            const btn = document.getElementById('nav-btn-settings');
            const r = btn.getBoundingClientRect();
            return {
                windowWidth: window.innerWidth,
                btnRight: r.right,
                marginRight: window.innerWidth - r.right,
                btnWidth: r.width,
                btnHeight: r.height
            };
        })()
        """
        send_cdp(2, "Runtime.evaluate", {"expression": eval_code, "returnByValue": True})
        eval_res = recv_cdp(2)
        print(f"Viewport {w}px info:", eval_res.get("result", {}).get("result", {}).get("value"))

        send_cdp(3, "Page.captureScreenshot", {"format": "png"})
        shot = recv_cdp(3)
        if shot and "result" in shot and "data" in shot["result"]:
            with open(f"scratch/fresh_navbar_{w}.png", "wb") as f:
                f.write(base64.b64decode(shot["result"]["data"]))
            print(f"Saved scratch/fresh_navbar_{w}.png")

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
