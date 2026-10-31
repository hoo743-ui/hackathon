"""시험용 가짜 uno_controller (pty). 실제 하드웨어가 아니다 — 프로토콜·스레드 경로만 확인한다."""
import os
import select
import threading
import time
import tty


class FakeUno:
    def __init__(self, distances=(20.0,), motion_sec=0.3, ack=True, hello=True):
        self.master, slave = os.openpty()
        tty.setraw(self.master)
        tty.setraw(slave)
        self.port = os.ttyname(slave)
        self._slave = slave
        self.distances = list(distances)
        self.motion_sec = motion_sec
        self.ack = ack
        self.hello = hello
        self.received: list[str] = []
        self.stop = threading.Event()
        self.busy = False
        threading.Thread(target=self._rx, daemon=True).start()
        threading.Thread(target=self._dist, daemon=True).start()

    def send(self, line: str) -> None:
        if self.stop.is_set():
            return
        try:
            os.write(self.master, (line + "\n").encode())
        except OSError:
            pass

    def _rx(self):
        buf = b""
        while not self.stop.is_set():
            try:
                r, _, _ = select.select([self.master], [], [], 0.05)
                if not r:
                    continue
                data = os.read(self.master, 64)
            except (OSError, ValueError):
                return
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                c = line.decode().strip()
                self.received.append(c)
                if c == "?" and self.hello:
                    self.send("HELLO:UNO_CTRL:1")
                elif c in ("G", "M", "P", "L") and self.ack:
                    if self.busy:
                        self.send(f"ACK:{c}:BUSY")
                        continue
                    self.busy = True
                    self.send(f"ACK:{c}:START")
                    threading.Timer(self.motion_sec, self._done, args=(c,)).start()
                elif c == "S" and self.ack:
                    self.busy = False
                    self.send("ACK:S:DONE")

    def _done(self, c):
        if self.busy:
            self.busy = False
            self.send(f"ACK:{c}:DONE")

    def _dist(self):
        i = 0
        while not self.stop.is_set() and self.distances:
            v = self.distances[min(i, len(self.distances) - 1)]
            self.send("DIST:ERR" if v is None else f"DIST:{v:.1f}")
            i += 1
            time.sleep(0.1)

    def close(self):
        self.stop.set()
        time.sleep(0.15)  # rx/dist 스레드가 멈출 시간
        for fd in (self.master, self._slave):
            try:
                os.close(fd)
            except OSError:
                pass
