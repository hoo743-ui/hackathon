"""시연 영상 녹화: 관리자 웹(1440×900)과 모바일 앱(390×844)을 동시에 열어 실시간 화면을 녹화하고
한 화면(1920×1080, 왼쪽 웹 · 오른쪽 폰)으로 합친 MP4 를 만든다.

- 로컬 Chrome(헤드리스) + DevTools 화면 스트림(Page.startScreencast) 사용 → 화면 기록 권한 불필요
- 녹화하는 동안 카메라 컴퓨터에서 실제 쓰레기를 넣으면, 웹과 앱이 같은 결과로 바뀌는 장면이 그대로 담긴다
- 화면에 보이는 데이터는 서버가 실제로 받은 것뿐이다 (이 스크립트는 데이터를 만들지 않는다)

사용 (맥북):
  backend/.venv/bin/python scripts/record_demo.py --seconds 90
  backend/.venv/bin/python scripts/record_demo.py --seconds 60 --web http://<IP>:5173 --app http://<IP>:8081 --out ~/Desktop/demo.mp4
필요: pip install imageio-ffmpeg pillow websockets (backend/.venv)
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets
from PIL import Image, ImageDraw, ImageFont

CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
W, H = 1920, 1080
BG = (246, 249, 246)
FOREST = (13, 67, 53)
INK2 = (99, 119, 112)


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "localhost"
    finally:
        s.close()


class Stream:
    """한 페이지의 화면 스트림. 마지막 프레임만 유지한다."""

    def __init__(self, name: str, url: str, width: int, height: int, scale: float):
        self.name, self.url, self.width, self.height, self.scale = name, url, width, height, scale
        self.latest: Image.Image | None = None
        self.frames = 0

    async def run(self, port: int, stop: asyncio.Event) -> None:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
        target = json.load(urllib.request.urlopen(req))
        async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
            seq = 0

            async def send(method: str, **params) -> None:
                nonlocal seq
                seq += 1
                await ws.send(json.dumps({"id": seq, "method": method, "params": params}))

            await send("Emulation.setDeviceMetricsOverride", width=self.width, height=self.height,
                       deviceScaleFactor=self.scale, mobile=self.width < 768)
            await send("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": "light"}])
            await send("Page.enable")
            await send("Page.navigate", url=self.url)
            await asyncio.sleep(3)
            await send("Page.startScreencast", format="jpeg", quality=85,
                       maxWidth=int(self.width * self.scale), maxHeight=int(self.height * self.scale), everyNthFrame=1)
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg.get("method") == "Page.screencastFrame":
                    p = msg["params"]
                    self.latest = Image.open(io.BytesIO(base64.b64decode(p["data"]))).convert("RGB")
                    self.frames += 1
                    await send("Page.screencastFrameAck", sessionId=p["sessionId"])
            await send("Page.stopScreencast")


def font(size: int) -> ImageFont.ImageFont:
    for f in ("/Library/Fonts/Pretendard-Bold.otf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "C:/Windows/Fonts/malgunbd.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def compose(web: Image.Image | None, app: Image.Image | None, title: str, clock: str) -> Image.Image:
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, 64], fill=FOREST)
    d.text((32, 18), "SMART RECYCLE", fill=(255, 255, 255), font=font(26))
    d.text((300, 22), title, fill=(169, 205, 189), font=font(20))
    d.text((W - 140, 22), clock, fill=(231, 243, 236), font=font(20))
    # 왼쪽: 관리자 웹
    if web is not None:
        wv = web.resize((1408, 880), Image.LANCZOS)
        canvas.paste(wv, (32, 112))
    d.text((32, 80), "관리자 웹", fill=INK2, font=font(18))
    d.rectangle([31, 111, 32 + 1408, 112 + 880], outline=(211, 225, 216))
    # 오른쪽: 폰 프레임
    px, py, pw, ph = 1480, 112, 400, 866
    d.rounded_rectangle([px - 10, py - 10, px + pw + 10, py + ph + 10], radius=44, fill=(28, 47, 43))
    if app is not None:
        av = app.resize((pw, ph), Image.LANCZOS)
        mask = Image.new("L", (pw, ph), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw, ph], radius=36, fill=255)
        canvas.paste(av, (px, py), mask)
    d.text((px, 80), "모바일 앱", fill=INK2, font=font(18))
    return canvas


def launch_chrome(port: int) -> tuple[subprocess.Popen, str]:
    # 헤드리스 Chrome 은 활성 탭만 화면을 흘려보내므로, 화면(웹·앱)마다 Chrome 을 하나씩 띄운다
    profile = tempfile.mkdtemp(prefix="sr-rec-")
    proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                             "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc, profile


async def wait_chrome(port: int) -> None:
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version")
            return
        except OSError:
            await asyncio.sleep(0.2)


async def record(args) -> Path:
    import imageio_ffmpeg

    chromes = [launch_chrome(args.port), launch_chrome(args.port + 1)]
    out = Path(os.path.expanduser(args.out))
    out.parent.mkdir(parents=True, exist_ok=True)
    writer = None
    try:
        await wait_chrome(args.port)
        await wait_chrome(args.port + 1)
        web = Stream("web", args.web, 1440, 900, 1)
        app = Stream("app", args.app, 390, 844, 2)
        stop = asyncio.Event()
        tasks = [asyncio.create_task(web.run(args.port, stop)), asyncio.create_task(app.run(args.port + 1, stop))]
        print(f"페이지 준비 중… (웹 {args.web} · 앱 {args.app})")
        for _ in range(100):
            if web.latest is not None and app.latest is not None:
                break
            await asyncio.sleep(0.2)
        writer = imageio_ffmpeg.write_frames(str(out), (W, H), fps=args.fps, codec="libx264", quality=8,
                                             macro_block_size=8, output_params=["-pix_fmt", "yuv420p"])
        writer.send(None)
        print(f"● 녹화 시작 {args.seconds}초 — 지금 카메라 컴퓨터에서 쓰레기를 넣으세요")
        t0 = time.monotonic()
        n = 0
        while (elapsed := time.monotonic() - t0) < args.seconds:
            frame = compose(web.latest, app.latest, args.title, time.strftime("%H:%M:%S"))
            writer.send(frame.tobytes())
            n += 1
            if n % (args.fps * 10) == 0:
                print(f"  {int(elapsed)}초…")
            await asyncio.sleep(max(0.0, n / args.fps - (time.monotonic() - t0)))
        stop.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        print(f"■ 녹화 끝: {n}프레임 · 웹 화면 {web.frames} · 앱 화면 {app.frames}")
        return out
    finally:
        if writer is not None:
            writer.close()
        for proc, profile in chromes:
            proc.terminate()
            proc.wait(5)
            shutil.rmtree(profile, ignore_errors=True)


def main() -> None:
    ip = lan_ip()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--web", default=f"http://{ip}:5173")
    ap.add_argument("--app", default=f"http://{ip}:8081")
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--fps", type=int, default=15)
    ap.add_argument("--title", default="실시간 분류 시연 — 웹·앱 동시 반영")
    ap.add_argument("--out", default=f"~/Desktop/SMART_RECYCLE_demo_{time.strftime('%Y%m%d_%H%M%S')}.mp4")
    ap.add_argument("--port", type=int, default=9444)
    args = ap.parse_args()
    out = asyncio.run(record(args))
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
