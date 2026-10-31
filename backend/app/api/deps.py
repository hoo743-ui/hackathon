from fastapi import Request

from app.hardware.interfaces import HardwareAdapter


def get_hardware(request: Request) -> HardwareAdapter:
    return request.app.state.hardware
