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

from smartrecycle_edge.config import EDGE_DIR, resolve_model_path, settings

LOG_DIR = EDGE_DIR / "logs"
LOG_FILE = LOG_DIR / "smart_recycle_ai.log"

OK, BAD, WARN, OFF = "#1f9d55", "#d64545", "#c58b00", "#8a8f98"
WASTE_KO = {"glass": "유리", "metal": "금속", "paper": "종이", "plastic": "플라스틱"}
HW_KO = {
    "completed": ("분류 성공 (장치 ACK:DONE 확인)", OK),
    "ack_timeout": ("실패: 장치 응답 시간 초과", BAD),
    "rejected_busy": ("실패: 장치가 동작 중이라 거부", BAD),
    "aborted": ("중단: 비상 정지", BAD),
    "command_sent": ("명령 전송됨 · 동작 확인 대기/불가", WARN),
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
            ("config", "설정 (.env)"), ("model", "YOLO 모델"), ("infer", "추론"), ("camera", "카메라"),
            ("hw", "Arduino UNO"), ("servo", "서보모터 ×3"), ("sensor", "HC-SR04 ×1"),
            ("esp32", "ESP32 DevKitC"), ("server", "맥북 서버"), ("queue", "전송 대기"),
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
            ("서버 재시도", self.retry_server), ("설정", self.open_settings), ("캡처", self.capture), ("로그", self.open_logs),
            ("안전 종료", self.quit),
        ]):
            ttk.Button(btns, text=t, command=cmd).grid(row=0, column=i, padx=2, sticky="ew")
            btns.columnconfigure(i, weight=1)

        estop = tk.Button(side, text="■ 비상 정지 (서보 대기 자세)", bg="#b3261e", fg="white", activebackground="#8c1d17",
                          font=("Arial", 11, "bold"), command=self.estop)
        estop.grid(row=4, column=0, sticky="ew", pady=(6, 0))

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

    def capture(self, tag: str = "") -> list[Path]:
        """발표·보고용: 프로그램 창 전체 + 최신 인식 화면(바운딩 박스)을 captures/ 에 저장."""
        import cv2
        from PIL import ImageGrab

        out = EDGE_DIR / "captures"
        out.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S") + (f"_{tag}" if tag else "")
        saved: list[Path] = []
        self.root.update_idletasks()
        x, y = self.root.winfo_rootx(), self.root.winfo_rooty()
        w, h = self.root.winfo_width(), self.root.winfo_height()
        try:
            win = out / f"program_{stamp}.png"
            ImageGrab.grab(bbox=(x, y, x + w, y + h), all_screens=True).save(win)
            saved.append(win)
        except Exception as exc:
            logging.getLogger("edge").warning("창 캡처 실패 (macOS: 화면 기록 권한 필요): %s", exc)
        if self.edge.latest_frame is not None:
            frame = out / f"detection_{stamp}.jpg"
            cv2.imwrite(str(frame), self.edge.latest_frame)
            saved.append(frame)
        logging.getLogger("edge").info("캡처 저장: %s", ", ".join(p.name for p in saved) or "없음")
        return saved

    def estop(self) -> None:
        self.edge.emergency_stop()

    def open_settings(self) -> None:
        SettingsDialog(self.root, on_saved=self.restart_program)

    def restart_program(self) -> None:
        """설정 저장 후 프로그램 재시작 (포트·카메라·모델은 시작할 때 한 번만 연다)."""
        self.edge.stop.set()
        self.edge.restart_camera.set()
        try:
            self.edge.uploader.stop(drain_sec=1)
            self.edge.hw.close()
            if self.edge.esp32:
                self.edge.esp32.close()
        finally:
            args = [sys.executable] + ([] if getattr(sys, "frozen", False) else [str(Path(__file__).resolve())])
            os.execv(sys.executable, args)

    def recheck(self) -> None:
        hw = self.edge.hw
        if self.edge.esp32:
            self.edge.esp32.retry()
        if hw.enabled and hw.link and not hw.connected and hw.link.port:
            hw.link.retry()
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
        disc = e.discovery
        disc_txt = "" if not disc else (" · 자동 탐색 " + ("수신 중" if disc.fresh_url() else ("오류: " + disc.error if disc.error else "신호 대기")))
        self._set("config", BAD if probs else OK, "; ".join(probs) or f"{settings.device_id} → {e.backend_url or '서버 찾는 중'}{disc_txt}")
        if e.yolo:
            self._set("model", OK, f"{e.model_name} · 로드 완료 · {len(e.yolo.names)} classes")
            self._set("infer", OK if e.yolo.camera_verified else WARN,
                      f"INFERENCE ONLY · {e.yolo.device_label} · {e.fps:.1f} FPS · imgsz {e.yolo.imgsz} · conf {e.yolo.conf}"
                      + ("" if e.yolo.camera_verified else " · 카메라 프레임 대기"))
        else:
            self._set("model", BAD if self.phase == "failed" else WARN, "로딩 중…" if self.phase == "starting" else e.status_msg)
            self._set("infer", BAD if self.phase == "failed" else WARN, "모델 없음 → 추론 안 함" if self.phase == "failed" else "대기")
        cam_ok = e.camera_ok
        self._set("camera", OK if cam_ok else (WARN if self.phase == "starting" else BAD),
                  f"CAMERA_INDEX={e.source}" if cam_ok else e.status_msg)
        hw = e.hw
        if not hw.enabled:
            self._set("hw", OFF, "비활성 (HW_ENABLED=false)")
            self._set("servo", OFF, "비활성")
        elif hw.connected:
            fw = {"uno_controller": "uno_controller (ACK·거리 지원)", "legacy": "trush.ino (응답 없음 → 성공 확인 불가)",
                  "unknown": "펌웨어 확인 중…"}[hw.firmware]
            self._set("hw", OK if hw.firmware == "uno_controller" else WARN, f"{hw.port} @ {settings.hw_baud} · {fw}")
            st = {"idle": ("대기", OK), "moving": ("동작 중", WARN), "unverified": ("명령 전송 · 동작 확인 불가", WARN),
                  "error": ("오류 (응답 없음/거부)", BAD), "stopped": ("비상 정지됨", BAD)}.get(hw.servo_state, (hw.servo_state, OFF))
            self._set("servo", st[1], f"{st[0]} · X(D9) 회전 · Y1(D10)/Y2(D11) 투하")
        else:
            self._set("hw", BAD, hw.last_error or f"{hw.port} 미연결")
            self._set("servo", BAD, "UNO 미연결 → 명령 안 보냄")
        sn = e.sensor
        sst = sn.status()
        if sst == "unknown":
            self._set("sensor", OFF if hw.firmware == "legacy" else WARN,
                      "거리값 수신 없음" + (" (trush.ino 는 거리를 보내지 않음 → uno_controller 업로드 필요)" if hw.firmware == "legacy" else ""))
        elif sst == "normal":
            fill = sn.fill_percent()
            self._set("sensor", OK, f"{sn.distance()} cm · 적재율 " + (f"{fill}%" if fill is not None else "— (EMPTY_DISTANCE_CM 미설정)")
                      + (f" · {settings.sensor_bin_id}" if settings.sensor_bin_id else " · 칸 미지정"))
        else:
            self._set("sensor", BAD, "SENSOR_DISCONNECTED" if sst == "disconnected" else "측정 오류 (범위 밖/응답 없음)")
        if e.esp32:
            i = e.esp32_info
            self._set("esp32", OK if e.esp32.connected and i["uno_link"] == "OK" else (WARN if e.esp32.connected else BAD),
                      (f"{e.esp32.port} · UNO 링크 {i['uno_link']} · Wi-Fi {i['wifi']} · HTTP {i['http']}") if e.esp32.connected
                      else (e.esp32.last_error or "미연결"))
        else:
            self._set("esp32", OFF, "사용 안 함 (설정에서 ESP32 포트 지정)")
        st = e.uploader.stats
        self._set("server", OK if e.backend_online else BAD,
                  f"{e.backend_url} · 성공 {st.ok} / 실패 {st.failed}" if e.backend_online else f"연결 안 됨 · {(st.last_error or e.backend_url or '서버 신호 대기')[:120]}")
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
        self.counts.config(text=f"누적 인식 {sum(c.values())}건 (플라스틱 {c['L']} · 금속 {c['M']} · 유리 {c['G']} · 종이 {c['P']})\n"
                                f"분류 성공(ACK) {e.sorted_ok} · 실패 {e.sorted_failed}")

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


class SettingsDialog:
    """Windows 현장 설정: 서버 IP · COM 포트(자동/수동) · 카메라 · 모델 경로 · 센서. 저장 → .env → 재시작."""

    FIELDS = [
        ("BACKEND_URL", "맥북 서버 주소 (http://<IP>:8000 · auto=자동 탐색)"),
        ("AI_API_TOKEN", "AI_API_TOKEN (맥북 .env 와 동일)"),
        ("CAMERA_INDEX", "카메라 번호"),
        ("HW_SERIAL_PORT", "Arduino UNO 포트 (auto 또는 COMx)"),
        ("ESP32_SERIAL_PORT", "ESP32 포트 (비우면 사용 안 함)"),
        ("MODEL_PATH", "모델 경로 (best_model.pt)"),
        ("SENSOR_BIN_ID", "초음파 센서 칸 (BIN_001~004)"),
        ("EMPTY_DISTANCE_CM", "빈 통 거리 cm (실측)"),
    ]

    def __init__(self, root, on_saved, reason: str = ""):
        from smartrecycle_edge.serial_ports import list_serial_ports

        self.on_saved = on_saved
        self.win = tk.Toplevel(root)
        self.win.title("SMART RECYCLE 설정")
        self.win.grab_set()
        f = ttk.Frame(self.win, padding=12)
        f.pack(fill="both", expand=True)
        if reason:
            ttk.Label(f, text=reason, foreground=BAD, wraplength=520).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))
        ports = ["auto", ""] + [p.device for p in list_serial_ports()]
        current = {
            "BACKEND_URL": settings.backend_url, "AI_API_TOKEN": settings.ai_api_token, "CAMERA_INDEX": settings.camera_index,
            "HW_SERIAL_PORT": settings.hw_serial_port, "ESP32_SERIAL_PORT": settings.esp32_serial_port,
            "MODEL_PATH": settings.model_path, "SENSOR_BIN_ID": settings.sensor_bin_id,
            "EMPTY_DISTANCE_CM": str(settings.empty_distance_cm or ""),
        }
        self.vars: dict[str, tk.StringVar] = {}
        for i, (key, label) in enumerate(self.FIELDS, start=1):
            ttk.Label(f, text=label).grid(row=i, column=0, sticky="w", pady=3)
            v = tk.StringVar(value=current[key])
            self.vars[key] = v
            if key in ("HW_SERIAL_PORT", "ESP32_SERIAL_PORT"):
                w = ttk.Combobox(f, textvariable=v, values=ports, width=40)
            elif key == "CAMERA_INDEX":
                w = ttk.Combobox(f, textvariable=v, values=[str(n) for n in range(6)], width=40)
            elif key == "SENSOR_BIN_ID":
                w = ttk.Combobox(f, textvariable=v, values=["", "BIN_001", "BIN_002", "BIN_003", "BIN_004"], width=40)
            else:
                w = ttk.Entry(f, textvariable=v, width=42, show="•" if key == "AI_API_TOKEN" else "")
            w.grid(row=i, column=1, sticky="ew", pady=3)
            if key == "MODEL_PATH":
                ttk.Button(f, text="찾기…", command=self.browse).grid(row=i, column=2, padx=4)
            if key == "CAMERA_INDEX":
                ttk.Button(f, text="탐색", command=self.scan_cameras).grid(row=i, column=2, padx=4)
        self.note = ttk.Label(f, text="COM 포트: 장치 관리자 › 포트(COM & LPT). 저장하면 프로그램이 다시 시작됩니다.", wraplength=520)
        self.note.grid(row=20, column=0, columnspan=3, sticky="w", pady=(8, 4))
        b = ttk.Frame(f)
        b.grid(row=21, column=0, columnspan=3, sticky="e")
        ttk.Button(b, text="취소", command=self.win.destroy).pack(side="right", padx=4)
        ttk.Button(b, text="저장 후 재시작", command=self.save).pack(side="right")

    def browse(self) -> None:
        from tkinter import filedialog

        path = filedialog.askopenfilename(title="best_model.pt 선택", filetypes=[("YOLO 모델", "*.pt"), ("모든 파일", "*.*")])
        if path:
            self.vars["MODEL_PATH"].set(path)

    def scan_cameras(self) -> None:
        import cv2

        found = []
        for i in range(6):
            cap = cv2.VideoCapture(i, cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_ANY)
            ok = cap.isOpened() and cap.read()[0]
            cap.release()
            if ok:
                found.append(str(i))
        self.note.config(text=f"사용 가능한 카메라: {', '.join(found) or '없음'} (실행 중인 프로그램이 쓰는 카메라는 목록에 안 나올 수 있음)")

    def save(self) -> None:
        from smartrecycle_edge.config import save_env

        values = {k: v.get().strip() for k, v in self.vars.items()}
        url = values["BACKEND_URL"]
        if url.lower() != "auto" and (not url.startswith("http://") or "localhost" in url or "127.0.0.1" in url):
            messagebox.showerror("설정", "서버 주소는 http://<맥북 LAN IP>:8000 또는 auto 여야 합니다 (localhost 금지).", parent=self.win)
            return
        if values["EMPTY_DISTANCE_CM"]:
            try:
                float(values["EMPTY_DISTANCE_CM"])
            except ValueError:
                messagebox.showerror("설정", "빈 통 거리는 숫자(cm)여야 합니다.", parent=self.win)
                return
        save_env(values)
        logging.getLogger("edge").info("설정 저장: %s", {k: ("***" if k == "AI_API_TOKEN" else v) for k, v in values.items()})
        self.win.destroy()
        self.on_saved()


def first_run_problems() -> list[str]:
    probs = list(settings.problems())
    if resolve_model_path(settings.model_path) is None:
        probs.append(f"best_model.pt 를 찾을 수 없음 (MODEL_PATH={settings.model_path}, {EDGE_DIR / 'models' / 'best_model.pt'})")
    return probs


def main() -> None:
    setup_logging()
    root = tk.Tk()
    try:
        app = App(root)
        probs = first_run_problems()
        if probs:  # 최초 실행/설정 누락 → 설정 화면부터
            root.after(300, lambda: SettingsDialog(root, on_saved=app.restart_program,
                                                   reason="필수 설정을 확인하세요:\n- " + "\n- ".join(probs)))
    except Exception as exc:  # 시작 단계 오류를 창으로 보여준다
        logging.exception("시작 오류")
        messagebox.showerror("SMART RECYCLE AI", f"시작 오류: {exc}\n로그: {LOG_FILE}")
        return
    root.mainloop()


if __name__ == "__main__":
    main()
