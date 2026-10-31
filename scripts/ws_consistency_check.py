"""웹(/ws/dashboard)과 앱(/ws) 두 WebSocket 클라이언트가 같은 분류 이벤트를 받는지 확인한다.

사용: backend/.venv/bin/python scripts/ws_consistency_check.py --base http://<맥북IP>:8000 --seconds 60
그동안 카메라 노트북에서 실제 쓰레기를 보여 준다. 수신한 detection_id 를 서버 DB(GET /api/detections/{id})와 대조한다.
"""
import argparse
import asyncio
import json
import urllib.request

import websockets


async def listen(name, url, seconds, out):
    async with websockets.connect(url) as ws:
        end = asyncio.get_event_loop().time() + seconds
        while (left := end - asyncio.get_event_loop().time()) > 0:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=left)
            except asyncio.TimeoutError:
                break
            if msg == "pong":
                continue
            ev = json.loads(msg)
            if ev.get("type") == "detection.updated":
                d = ev["data"]
                out.setdefault(d["detection_id"], {})[name] = (d["waste_type"], d["confidence"], d.get("image_url"))
                print(f"[{name}] {d['detection_id']} {d['waste_type']} {d['confidence']:.2f}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--seconds", type=float, default=60)
    a = ap.parse_args()
    ws = a.base.replace("http", "ws", 1)
    got: dict = {}
    await asyncio.gather(listen("web", f"{ws}/ws/dashboard", a.seconds, got), listen("app", f"{ws}/ws", a.seconds, got))
    ok = True
    for did, seen in got.items():
        db = json.load(urllib.request.urlopen(f"{a.base}/api/detections/{did}"))
        same = seen.get("web") == seen.get("app") and "web" in seen and "app" in seen
        img = urllib.request.urlopen(a.base + db["image_url"]).status if db.get("image_url") else None
        print(f"{'PASS' if same and img == 200 else 'FAIL'} {did}: web={seen.get('web')} app={seen.get('app')} db={db['waste_type']} image={img}")
        ok &= same and img == 200
    print(f"이벤트 {len(got)}건, {'모두 일치' if ok and got else '불일치 또는 0건'}")


asyncio.run(main())
