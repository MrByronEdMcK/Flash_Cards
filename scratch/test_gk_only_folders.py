import urllib.request
import json
import time
import socket
import base64
import os
import subprocess
import shutil

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = f"C:\\Users\\charl\\AppData\\Local\\Temp\\chrome_decks_{int(time.time())}"
port = 9275

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
    
    key = base64.b64encode(b"1122334455667788").decode()
    handshake = f"GET {path} HTTP/1.1\r\nHost: {host}:{p_num}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    s.sendall(handshake.encode())
    s.recv(4096)

    def send_cdp(cmd_id, method, params=None):
        msg = {"id": cmd_id, "method": method}
        if params: msg["params"] = params
        data = json.dumps(msg).encode()
        mask = b"MASK"
        l = len(data)
        h = bytearray([0x81])
        if l <= 125: h.append(0x80 | l)
        elif l <= 65535: h.append(0x80 | 126); h.extend(l.to_bytes(2, "big"))
        else: h.append(0x80 | 127); h.extend(l.to_bytes(8, "big"))
        h.extend(mask)
        masked = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
        s.sendall(h + masked)

    def recv_cdp(target_id):
        buf = bytearray()
        while True:
            c = s.recv(65536)
            if not c: break
            buf.extend(c)
            while len(buf) >= 2:
                pl = buf[1] & 0x7f
                off = 2
                if pl == 126:
                    if len(buf) < 4: break
                    pl = int.from_bytes(buf[2:4], "big")
                    off = 4
                elif pl == 127:
                    if len(buf) < 10: break
                    pl = int.from_bytes(buf[2:10], "big")
                    off = 10
                if len(buf) < off + pl: break
                chunk = buf[off:off+pl]
                buf = buf[off+pl:]
                try:
                    obj = json.loads(chunk.decode("utf-8"))
                    if obj.get("id") == target_id: return obj
                except: pass

    send_cdp(1, "Runtime.enable")
    time.sleep(1.5)

    # Click on "Folders & Decks" nav link
    click_script = """
    (() => {
        const link = document.querySelector('[data-view="decks"]');
        if (link) link.click();
    })()
    """
    send_cdp(2, "Runtime.evaluate", {"expression": click_script})
    recv_cdp(2)
    time.sleep(1)

    send_cdp(3, "Page.captureScreenshot", {"format": "png"})
    shot = recv_cdp(3)
    with open("scratch/gk_only_folders.png", "wb") as f:
        f.write(base64.b64decode(shot["result"]["data"]))
    print("Screenshot saved to scratch/gk_only_folders.png")

    s.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=2)
    except: proc.kill()
    try: shutil.rmtree(user_data, ignore_errors=True)
    except: pass
