"""시각 QA 도구: 로컬 Chrome(헤드리스) + DevTools Protocol로 정확한 뷰포트 폭의 스크린샷과 콘솔 오류를 수집한다.

예:
  scripts/screenshot.sh --base http://localhost:5173 --pages /,/control --widths 1440,390
출력: <out>/<page>@<width>.png, 콘솔 오류/예외는 표준출력에 요약 (오류가 있으면 종료코드 1)
"""
import argparse
import asyncio
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websockets

CHROME = os.environ.get("CHROME_BIN", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def slug(path: str) -> str:
    s = path.strip("/").replace("/", "_").replace("?", "_").replace("=", "-").replace("&", "_")
    return s or "home"


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.next_id = 0
        self.events: list[dict] = []

    async def call(self, method: str, **params):
        self.next_id += 1
        my_id = self.next_id
        await self.ws.send(json.dumps({"id": my_id, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == my_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)

    async def drain(self, seconds: float):
        end = time.time() + seconds
        while time.time() < end:
            try:
                self.events.append(json.loads(await asyncio.wait_for(self.ws.recv(), end - time.time())))
            except (TimeoutError, asyncio.TimeoutError):
                break


def console_problems(events: list[dict]) -> list[str]:
    out = []
    for e in events:
        m, p = e.get("method"), e.get("params", {})
        if m == "Runtime.exceptionThrown":
            d = p.get("exceptionDetails", {})
            out.append("exception: " + (d.get("exception", {}).get("description") or d.get("text", ""))[:300])
        elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
            out.append("console.error: " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:300])
        elif m == "Log.entryAdded" and p.get("entry", {}).get("level") == "error":
            out.append("log: " + p["entry"].get("text", "")[:300])
    return out


async def shoot(port: int, url: str, width: int, height: int, out: Path, wait: float, full: bool, theme: str | None) -> list[str]:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
    target = json.loads(urllib.request.urlopen(req).read())
    async with websockets.connect(target["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as ws:
        cdp = CDP(ws)
        await cdp.call("Runtime.enable")
        await cdp.call("Log.enable")
        await cdp.call("Page.enable")
        mobile = width < 768
        await cdp.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=mobile)
        if theme:
            await cdp.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-color-scheme", "value": theme}])
        await cdp.call("Page.navigate", url=url)
        await cdp.drain(wait)
        # 가로 넘침 검사
        overflow = await cdp.call(
            "Runtime.evaluate",
            expression="JSON.stringify({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})",
            returnByValue=True,
        )
        dims = json.loads(overflow["result"]["value"])
        problems = console_problems(cdp.events)
        if dims["sw"] > dims["cw"] + 1:
            problems.append(f"horizontal overflow: scrollWidth {dims['sw']} > viewport {dims['cw']}")
        clip = None
        if full:
            metrics = await cdp.call("Page.getLayoutMetrics")
            h = int(min(metrics["cssContentSize"]["height"], 6000))
            await cdp.call("Emulation.setDeviceMetricsOverride", width=width, height=max(h, height), deviceScaleFactor=1, mobile=mobile)
            await cdp.drain(0.5)
        shot = await cdp.call("Page.captureScreenshot", format="png", captureBeyondViewport=full, clip=clip) if clip else await cdp.call("Page.captureScreenshot", format="png", captureBeyondViewport=full)
        out.write_bytes(base64.b64decode(shot["data"]))
        await cdp.call("Page.close")
        return problems


async def main_async(args) -> int:
    port = args.port
    profile = tempfile.mkdtemp(prefix="sr-chrome-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
         "--hide-scrollbars", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version")
                break
            except OSError:
                await asyncio.sleep(0.2)
        out_dir = Path(args.out)
        out_dir.mkdir(parents=True, exist_ok=True)
        failed = 0
        for page in args.pages.split(","):
            for w in [int(x) for x in args.widths.split(",")]:
                h = 844 if w < 768 else (1024 if w < 1280 else 900)
                suffix = f"-{args.theme}" if args.theme else ""
                out = out_dir / f"{slug(page)}@{w}{suffix}.png"
                problems = await shoot(port, args.base.rstrip("/") + page, w, h, out, args.wait, args.full, args.theme)
                status = "OK " if not problems else "ERR"
                print(f"{status} {page} @{w} → {out}")
                for p in problems:
                    print(f"     - {p}")
                failed += bool(problems)
        return 1 if failed else 0
    finally:
        proc.terminate()
        proc.wait(5)
        shutil.rmtree(profile, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--pages", default="/")
    ap.add_argument("--widths", default="1920,1440,1280,768,390")
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "smart-recycle-qa"), help="저장 폴더 (기본: 임시 폴더 — 저장소에 남기지 않음)")
    ap.add_argument("--wait", type=float, default=4.0, help="페이지 로드 후 대기(초)")
    ap.add_argument("--full", action="store_true", help="전체 페이지 높이로 캡처")
    ap.add_argument("--theme", choices=["light", "dark"], help="prefers-color-scheme 강제")
    ap.add_argument("--port", type=int, default=9333)
    raise SystemExit(asyncio.run(main_async(ap.parse_args())))


if __name__ == "__main__":
    main()
