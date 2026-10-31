import cv2
import time
import serial
from ultralytics import YOLO

SERIAL_PORT = 'COM4'  # 본인 COM 포트로 수정
BAUD_RATE = 9600

try:
    arduino = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    time.sleep(2)
    print(f"아두이노 연결 성공: {SERIAL_PORT}")
except Exception as e:
    print(f"아두이노 연결 실패: {e}")
    arduino = None

model = YOLO("best_model.pt")

CLASS_SIGNAL_MAP = {
    0: 'G',  # Glass
    1: 'M',  # Metal
    2: 'P',  # Paper
    3: 'L'   # Plastic
}

TARGET_CLASSES = [0, 1, 2, 3]

cap = cv2.VideoCapture(0)

last_sent_time = 0
SEND_COOLDOWN = 2.0 

# 구역별 카운터
counts = {'G': 0, 'M': 0, 'P': 0, 'L': 0}

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    results = model(frame, conf=0.5, classes=TARGET_CLASSES)
    current_time = time.time()

    if len(results[0].boxes) > 0 and (current_time - last_sent_time > SEND_COOLDOWN):
        top_box = results[0].boxes[0]
        cls_id = int(top_box.cls[0])
        conf = float(top_box.conf[0])

        if cls_id in CLASS_SIGNAL_MAP:
            signal = CLASS_SIGNAL_MAP[cls_id]
            
            if arduino and arduino.is_open:
                counts[signal] += 1
                
                # 1. 아두이노로 종류 신호 전송 (동작 실행용)
                arduino.write(signal.encode('utf-8'))
                time.sleep(0.1)
                
                # 2. 종류별 갱신된 카운트 전송 (예: "C:L:3\n")
                count_msg = f"C:{signal}:{counts[signal]}\n"
                arduino.write(count_msg.encode('utf-8'))
                
                print(f"[투입] {model.names[cls_id]} | 누적 카운트: {counts}")
                last_sent_time = current_time

    # 화면에 구역별 카운트 표시
    annotated_frame = results[0].plot()
    display_text = f"P:{counts['L']} | M:{counts['M']} | G:{counts['G']} | Pa:{counts['P']}"
    cv2.putText(annotated_frame, display_text, (20, 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2, cv2.LINE_AA)

    cv2.imshow("YOLO 4-Zone Counter", annotated_frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord('q'):
        break
    elif key == ord('r'): # 카운트 전체 초기화
        counts = {'G': 0, 'M': 0, 'P': 0, 'L': 0}
        if arduino and arduino.is_open:
            arduino.write("C:RESET\n".encode('utf-8'))
        print("전체 카운트가 초기화되었습니다.")

cap.release()
cv2.destroyAllWindows()
if arduino and arduino.is_open:
    arduino.close()