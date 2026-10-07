import subprocess
import time
import json
import urllib.request
import base64
import os
import socket

def p(s):
    print(str(s).encode('ascii', 'backslashreplace').decode('ascii'))

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data = r"C:\Users\charl\AppData\Local\Temp\chrome_test_titles2"

proc = subprocess.Popen([
    chrome_path,
    "--headless=new",
    "--disable-gpu",
    "--incognito",
    "--disable-cache",
    f"--user-data-dir={user_data}",
    "--remote-debugging-port=9239",
    "--window-size=1280,800",
    "http://localhost:8080/index.html"
], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    time.sleep(2.5)

    req = urllib.request.urlopen("http://127.0.0.1:9239/json")
    pages = json.loads(req.read().decode())
    target_page = next((p for p in pages if "localhost:8080" in p.get("url", "")), pages[0])
    ws_url = target_page.get("webSocketDebuggerUrl")

    host = "127.0.0.1"
    port = 9239
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

    p("\n=======================================================")
    p(" AUDITING CHROME WINDOW TITLES & IN-PAGE TITLES")
    p("=======================================================")

    # 1. Initial Load / Dashboard
    eval_js("window.app.navigate('dashboard')")
    time.sleep(0.3)
    dash_title = eval_js("document.title")
    dash_h1 = eval_js("document.querySelector('.hero-title')?.innerText")
    dash_h2_calendar = eval_js("document.querySelector('.forecast-calendar-section h2')?.innerText")
    dash_h2_classes = eval_js("document.querySelector('.section-header .section-title')?.innerText")
    p(f"[Dashboard] Chrome Title: '{dash_title}'")
    p(f"            Hero Title:   '{dash_h1}'")
    p(f"            Calendar H2:  '{dash_h2_calendar}'")
    p(f"            Classes H2:   '{dash_h2_classes}'")
    assert dash_title == "Dashboard | StudyCards", f"Bad title: {dash_title}"

    # 2. Decks View
    eval_js("window.app.navigate('decks')")
    time.sleep(0.3)
    decks_title = eval_js("document.title")
    sidebar_title = eval_js("document.querySelector('.tree-sidebar-header h3')?.innerText")
    group_header = eval_js("document.querySelector('.group-title')?.innerText")
    cards_list_h4 = eval_js("document.querySelector('.cards-list-header h4')?.innerText")
    p(f"[Decks]     Chrome Title: '{decks_title}'")
    p(f"            Sidebar H3:   '{sidebar_title}'")
    p(f"            Selected Deck:'{group_header}'")
    p(f"            Cards List H4:'{cards_list_h4}'")
    assert decks_title == "Folders & Decks | StudyCards", f"Bad title: {decks_title}"
    assert sidebar_title == "Folders & Decks", f"Bad sidebar title: {sidebar_title}"

    # 3. Study Session (Daily)
    eval_js("window.app.navigate('study', { mode: 'daily' })")
    time.sleep(0.3)
    study_title = eval_js("document.title")
    study_header = eval_js("document.querySelector('.study-group-name')?.innerText")
    p(f"[Study Daily] Chrome Title: '{study_title}'")
    p(f"              Session Meta: '{study_header}'")
    assert "StudyCards" in study_title, f"Bad study title: {study_title}"

    # 4. Study Session (Endless)
    eval_js("window.app.navigate('study', { mode: 'endless' })")
    time.sleep(0.3)
    study_endless_title = eval_js("document.title")
    p(f"[Study Endless] Chrome Title: '{study_endless_title}'")
    assert "StudyCards" in study_endless_title, f"Bad endless title: {study_endless_title}"

    # 5. Session Complete
    eval_js("window.app.studyView._renderCompletion()")
    time.sleep(0.3)
    comp_title = eval_js("document.title")
    comp_h2 = eval_js("document.querySelector('.completion-title')?.innerText")
    p(f"[Completion] Chrome Title: '{comp_title}'")
    p(f"             Heading:      '{comp_h2}'")
    assert comp_title == "Session Complete | StudyCards", f"Bad completion title: {comp_title}"

    # 6. Modals - New Folder/Deck
    eval_js("window.app.navigate('decks')")
    time.sleep(0.2)
    eval_js("window.dispatchEvent(new CustomEvent('open-group-modal', { detail: {} }))")
    time.sleep(0.3)
    group_modal_title = eval_js("document.getElementById('group-modal-title')?.innerText")
    group_level_label = eval_js("document.querySelector('label[for=\"select-group-type\"]')?.innerText")
    p(f"[Modal Deck]  Modal Title:  '{group_modal_title}'")
    p(f"              Level Label:  '{group_level_label}'")
    assert group_modal_title == "New Folder / Deck", f"Bad modal title: {group_modal_title}"
    eval_js("document.getElementById('group-modal')?.classList.add('hidden')")

    # 7. Modals - Import Modal
    eval_js("window.app.modals.openImportExportModal({})")
    time.sleep(0.3)
    import_modal_title = eval_js("document.getElementById('io-modal-title')?.innerText")
    p(f"[Modal Import] Modal Title: '{import_modal_title}'")
    assert import_modal_title == "Deck Import & Backup", f"Bad import modal title: {import_modal_title}"
    eval_js("document.getElementById('import-export-modal')?.classList.add('hidden')")

    # 8. Modals - Settings Modal
    eval_js("window.app.modals.openSettingsModal()")
    time.sleep(0.3)
    settings_modal_title = eval_js("document.querySelector('#settings-modal h3')?.innerText")
    p(f"[Modal Settings] Modal Title:'{settings_modal_title}'")
    assert settings_modal_title == "Study Settings", f"Bad settings title: {settings_modal_title}"
    eval_js("document.getElementById('settings-modal')?.classList.add('hidden')")

    # 9. Modals - Card Editor Modal
    eval_js("window.app.cardEditor.open({})")
    time.sleep(0.3)
    card_modal_title = eval_js("document.getElementById('card-editor-title')?.innerText")
    p(f"[Modal Card]  Modal Title:  '{card_modal_title}'")
    assert card_modal_title == "Create Flashcard", f"Bad card editor title: {card_modal_title}"
    eval_js("document.getElementById('card-editor-modal')?.classList.add('hidden')")

    p("\nALL TITLES AND CHROME HEADINGS ARE VERIFIED AND USER APPROPRIATE!")

finally:
    proc.kill()
