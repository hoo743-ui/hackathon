"""SMART RECYCLE AI — 카메라 노트북 통합 실행 프로그램 (GUI).

이 프로그램 하나로: 카메라 · YOLO · 하드웨어 시리얼(단독 소유) · 센서 이벤트 · 서버 전송 · 상태 표시 · 로그.
서버(맥북)와 하드웨어(Arduino/ESP32)는 각자 실제로 동작해야 하며, 이 프로그램은 그 사이를 잇는 현장 컨트롤러다.

빌드: build_exe.bat (Windows) / build_exe.sh (macOS·Linux) → dist/SMART_RECYCLE_AI/SMART_RECYCLE_AI(.exe)
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
from logging.handlers import RotatingFileHandler
from pathlib import Path
from tkinter import messagebox, ttk
from types import SimpleNamespace

from smartrecycle_edge.config import EDGE_DIR, settings

LOG_DIR = EDGE_DIR / "logs"
LOG_FILE = LOG_DIR / "smart_recycle_ai.log"

OK, BAD, WARN, OFF = "#1f9d55", "#d64545", "#c58b00", "#8a8f98"
WASTE_KO = {"glass": "유리", "metal": "금속", "paper": "종이", "plastic": "플라스틱"}
HW_KO = {
    "command_sent": ("명령 전송됨 (장치 응답 없음 · 동작 미확인)", WARN),
    "not_connected": ("하드웨어 미연결 → 동작 안 함", BAD),
    "serial_failed": ("시리얼 전송 실패", BAD),
    "skipped_busy": ("이전 동작 중 → 생략", WARN),
    "disabled": ("하드웨어 비활성 / 해당 클래스 없음", OFF),
}


def setup_logging() -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fh = RotatingFileHandler(LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    root.addHandler(sh)


class GuiLogHandler(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.lines: list[str] = []
        self.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S"))

    def emit(self, record):
        self.lines.append(self.format(record))
        del self.lines[:-200]


class App:
    def __init__(self, root: tk.Tk):
        from start_camera_system import EdgeApp  # cv2/ultralytics import 는 창을 띄운 뒤

        self.root = root
        self.edge = EdgeApp(SimpleNamespace(source=None, no_hw=False, headless=True, max_events=0, gui=True))
        self.loghandler = GuiLogHandler()
        logging.getLogger().addHandler(self.loghandler)
        self.phase = "starting"
        self.photo = None
        self._build()
        threading.Thread(target=self._boot, name="boot", daemon=True).start()
        self.root.after(100, self._tick)

    # --- 화면 구성 ---
    def _build(self) -> None:
        r = self.root
        r.title("SMART RECYCLE AI — 카메라 컴퓨터")
        r.geometry("1280x760")
        r.minsize(1000, 640)
        r.protocol("WM_DELETE_WINDOW", self.quit)
        main = ttk.Frame(r, padding=8)
        main.pack(fill="both", expand=True)
        main.columnconfigure(0, weight=3)
        main.columnconfigure(1, weight=2)
        main.rowconfigure(0, weight=1)

        self.video = tk.Label(main, bg="#111", fg="#ddd", text="카메라 준비 중…", font=("Arial", 16))
        self.video.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        side = ttk.Frame(main)
        side.grid(row=0, column=1, sticky="nsew")
        side.columnconfigure(0, weight=1)

        box = ttk.LabelFrame(side, text="연결 상태", padding=8)
        box.grid(row=0, column=0, sticky="ew")
        self.rows = {}
        for i, (key, label) in enumerate([
            ("config", "설정 (.env)"), ("model", "YOLO 모델"), ("camera", "카메라"),
            ("hw", "하드웨어 (Arduino 시리얼)"), ("esp32", "ESP32 USB (모니터)"), ("server", "맥북 서버"),
            ("queue", "전송 대기"),
        ]):
            ttk.Label(box, text=label, width=24).grid(row=i, column=0, sticky="w", pady=2)
            dot = tk.Label(box, text="●", fg=OFF, font=("Arial", 14))
            dot.grid(row=i, column=1, padx=4)
            val = ttk.Label(box, text="-", wraplength=300)
            val.grid(row=i, column=2, sticky="w")
            self.rows[key] = (dot, val)

        det = ttk.LabelFrame(side, text="최근 분류", padding=8)
        det.grid(row=1, column=0, sticky="ew", pady=8)
        self.det_type = tk.Label(det, text="-", font=("Arial", 28, "bold"))
        self.det_type.grid(row=0, column=0, columnspan=2, sticky="w")
        self.det_info = ttk.Label(det, text="", justify="left", wraplength=420)
        self.det_info.grid(row=1, column=0, columnspan=2, sticky="w")
        self.det_hw = tk.Label(det, text="", font=("Arial", 12, "bold"))
        self.det_hw.grid(row=2, column=0, columnspan=2, sticky="w", pady=(4, 0))
        self.counts = ttk.Label(det, text="")
        self.counts.grid(row=3, column=0, columnspan=2, sticky="w", pady=(4, 0))

        btns = ttk.Frame(side)
        btns.grid(row=2, column=0, sticky="ew")
        for i, (t, cmd) in enumerate([
            ("연결 재확인", self.recheck), ("카메라 재시작", self.restart_camera),
            ("서버 재시도", self.retry_server), ("로그 폴더", self.open_logs), ("안전 종료", self.quit),
        ]):
            ttk.Button(btns, text=t, command=cmd).grid(row=0, column=i, padx=2, sticky="ew")
            btns.columnconfigure(i, weight=1)

        logf = ttk.LabelFrame(side, text="이벤트 로그", padding=4)
        logf.grid(row=3, column=0, sticky="nsew", pady=(8, 0))
        side.rowconfigure(3, weight=1)
        self.logtext = tk.Text(logf, height=12, wrap="none", font=("Consolas", 9), state="disabled")
        self.logtext.pack(fill="both", expand=True)

        self.statusbar = ttk.Label(r, text="", anchor="w", padding=(8, 2))
        self.statusbar.pack(fill="x", side="bottom")

    # --- 동작 ---
    def _boot(self) -> None:
        code = self.edge.prepare()
        if code == 0:
            self.phase = "running"
            self.edge.loop()
            self.phase = "stopped"
        else:
            self.phase = "failed"
            logging.getLogger("edge").error("시작 실패: %s", self.edge.status_msg)

    def recheck(self) -> None:
        hw = self.edge.hw
        if hw.enabled and hw.link and not hw.connected and hw.link.port:
            threading.Thread(target=hw.link.open, daemon=True).start()
        elif hw.enabled and hw.link and not hw.link.port:
            from smartrecycle_edge.serial_ports import resolve_hw_port

            port, note = resolve_hw_port(settings.hw_serial_port, {settings.esp32_serial_port})
            logging.getLogger("edge").info("하드웨어 포트 재탐색: %s (%s)", port, note)
            if port:
                hw.link.port = port
                hw.link._reconnects = 0
                threading.Thread(target=hw.link.open, daemon=True).start()
        self.retry_server()

    def restart_camera(self) -> None:
        if self.phase == "failed":
            messagebox.showinfo("카메라", "카메라 연결 후 프로그램을 다시 실행하세요.\n" + self.edge.status_msg)
            return
        self.edge.restart_camera.set()

    def retry_server(self) -> None:
        self.edge.heartbeat.was_online = False  # 다음 heartbeat 를 2초 안에, 성공하면 outbox 재전송
        self.edge.uploader.flush_outbox() if self.edge.backend_online else None

    def open_logs(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        if sys.platform.startswith("win"):
            os.startfile(LOG_DIR)  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(LOG_DIR)])

    def quit(self) -> None:
        if not messagebox.askokcancel("종료", "프로그램을 종료할까요?\n(전송하지 못한 분류는 outbox 에 저장되어 다음 실행 때 전송됩니다)"):
            return
        self.edge.stop.set()
        self.edge.restart_camera.set()
        self.statusbar.config(text="종료 중… 전송 대기열 정리")
        self.root.after(200, self._finish)

    def _finish(self) -> None:
        if self.phase == "running":
            self.root.after(200, self._finish)
            return
        if self.phase == "failed":  # loop 미실행 → 직접 정리
            self.edge.heartbeat.stop_event.set()
            self.edge.uploader.stop(drain_sec=1)
            self.edge.hw.close()
        self.root.destroy()

    # --- 화면 갱신 ---
    def _set(self, key: str, color: str, text: str) -> None:
        dot, val = self.rows[key]
        dot.config(fg=color)
        val.config(text=text)

    def _tick(self) -> None:
        e = self.edge
        probs = settings.problems()
        self._set("config", BAD if probs else OK, "; ".join(probs) or f"{settings.device_id} → {settings.backend_url}")
        if e.yolo:
            self._set("model", OK, f"{Path(settings.model_path).name} · {len(e.yolo.names)} classes")
        else:
            self._set("model", BAD if self.phase == "failed" else WARN, "로딩 중…" if self.phase == "starting" else e.status_msg)
        cam_ok = e.camera_ok
        self._set("camera", OK if cam_ok else (WARN if self.phase == "starting" else BAD),
                  f"CAMERA_INDEX={e.source} · {e.fps:.1f} fps" if cam_ok else e.status_msg)
        hw = e.hw
        if not hw.enabled:
            self._set("hw", OFF, "비활성 (HW_ENABLED=false)")
        elif hw.connected:
            self._set("hw", WARN if hw.busy else OK, f"{hw.port} @ {settings.hw_baud}" + (" · 동작 중" if hw.busy else ""))
        else:
            self._set("hw", BAD, hw.last_error or f"{hw.port} 미연결")
        if e.esp32:
            self._set("esp32", OK if e.esp32.connected else BAD, e.esp32.port if e.esp32.connected else (e.esp32.last_error or "미연결"))
        else:
            self._set("esp32", OFF, "사용 안 함 (ESP32_SERIAL_PORT 비어 있음)")
        st = e.uploader.stats
        self._set("server", OK if e.backend_online else BAD,
                  f"연결됨 · 성공 {st.ok} / 실패 {st.failed}" if e.backend_online else f"연결 안 됨 · {(st.last_error or settings.backend_url)[:120]}")
        q = e.uploader.pending
        self._set("queue", OK if q == 0 else WARN, f"{q}건" + (" (서버 복구 시 자동 재전송)" if q else ""))

        d = e.last_detection
        if d:
            name = d["waste_type"]
            self.det_type.config(text=f"{WASTE_KO.get(name, name)}  {d['confidence']:.2f}")
            self.det_info.config(text=f"ID {d['detection_id']}\n{d['time']} · class {d['class_id']} · 신호 {d['signal'] or '-'}")
            t, c = HW_KO.get(d["hardware_status"], (d["hardware_status"], OFF))
            self.det_hw.config(text=f"하드웨어: {t}", fg=c)
        c = e.counts
        self.counts.config(text=f"명령 전송 횟수 — 플라스틱 {c['L']} · 금속 {c['M']} · 유리 {c['G']} · 종이 {c['P']}")

        frame = e.latest_frame
        if frame is not None:
            self._show(frame)
        elif self.phase == "failed":
            self.video.config(image="", text="⚠ " + e.status_msg)

        lines = self.loghandler.lines[-14:]
        self.logtext.config(state="normal")
        self.logtext.delete("1.0", "end")
        self.logtext.insert("end", "\n".join(lines))
        self.logtext.config(state="disabled")
        self.statusbar.config(text=f"{e.status_msg} · 로그: {LOG_FILE}")
        self.root.after(66, self._tick)

    def _show(self, frame) -> None:
        import cv2
        from PIL import Image, ImageTk

        w, h = max(self.video.winfo_width(), 320), max(self.video.winfo_height(), 240)
        fh, fw = frame.shape[:2]
        scale = min(w / fw, h / fh)
        img = cv2.resize(frame, (max(1, int(fw * scale)), max(1, int(fh * scale))))
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        self.photo = ImageTk.PhotoImage(Image.fromarray(img))
        self.video.config(image=self.photo, text="")


def main() -> None:
    setup_logging()
    root = tk.Tk()
    try:
        App(root)
    except Exception as exc:  # 시작 단계 오류를 창으로 보여준다
        logging.exception("시작 오류")
        messagebox.showerror("SMART RECYCLE AI", f"시작 오류: {exc}\n로그: {LOG_FILE}")
        return
    root.mainloop()


if __name__ == "__main__":
    main()
