# 데이터베이스 스키마 (초안)

PostgreSQL 16, 마이그레이션 `backend/alembic/versions/`, 모든 시각은 `timestamptz`(UTC). 마이그레이션은 Alembic으로만 변경한다.
현재 상태(`devices`, `bins`)와 이력(`sensor_logs`, `device_commands`, `detection_logs`)을 분리한다.

## devices
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | bigserial | PK |
| device_id | varchar(32) | UNIQUE NOT NULL |
| device_name | varchar(100) | |
| connection_status | varchar(16) | `online`/`offline`/`unknown` |
| operating_mode | varchar(16) | `AUTO`/`MANUAL` (명세 대비 추가) |
| estop_active | boolean | default false (추가) |
| data_source | varchar(16) | 마지막 수신 source: `hardware`/`simulator` (추가) |
| firmware_version | varchar(32) | status 메시지에서 갱신 (추가) |
| last_seen | timestamptz | |
| created_at | timestamptz | default now() |

## bins
| 컬럼 | 타입 | 제약 |
|---|---|---|
| id | bigserial | PK |
| bin_id | varchar(32) | UNIQUE NOT NULL |
| device_id | varchar(32) | FK → devices.device_id |
| waste_type | varchar(16) | `plastic`/`can`/`paper`/`general`, UNIQUE(device_id, waste_type) |
| empty_distance_cm | double precision | NULL 허용 = **미보정** |
| full_distance_cm | double precision | NULL 허용, CHECK full < empty |
| current_distance_cm | double precision | 마지막 **정상** 측정값 |
| current_fill_percent | double precision | 마지막 정상 측정 기반, 미보정이면 NULL |
| sensor_status | varchar(16) | 마지막 측정의 상태 |
| last_valid_at | timestamptz | 마지막 정상 측정 시각 (추가) |
| updated_at | timestamptz | |

> 센서 오류(`sensor_status != normal`)는 `current_*`를 덮어쓰지 않는다. 따라서 "오류"와 "적재율 0%"가 구분된다.

## sensor_logs
| 컬럼 | 타입 |
|---|---|
| id | bigserial PK |
| device_id | varchar(32) FK |
| bin_id | varchar(32) FK → bins.bin_id |
| distance_cm | double precision NULL |
| fill_percent | double precision NULL |
| sensor_status | varchar(16) |
| source | varchar(16) |
| measured_at | timestamptz |
| received_at | timestamptz default now() |

인덱스: `(bin_id, measured_at DESC)`

## device_commands
| 컬럼 | 타입 |
|---|---|
| id | bigserial PK |
| command_id | uuid UNIQUE |
| device_id | varchar(32) FK |
| command | varchar(32) |
| target | varchar(16) NULL |
| status | `PENDING`/`SENT`/`SUCCEEDED`/`FAILED`/`TIMEOUT` (검증에서 거부된 요청은 저장하지 않고 4xx 응답) |
| requested_by | varchar(64) NULL (추가) |
| requested_at | timestamptz |
| expires_at | timestamptz (추가) |
| executed_at | timestamptz NULL |
| result_message | varchar(64) NULL — 장치 ACK message (추가) |
| error_message | text NULL |

인덱스: `(device_id, requested_at DESC)`, 부분 인덱스 `(device_id) WHERE status IN ('PENDING','SENT')` — 진행 중 명령 중복 확인용.

## detection_logs (PHASE 7)
| 컬럼 | 타입 |
|---|---|
| id | bigserial PK |
| device_id | varchar(32) FK |
| bin_id | varchar(32) FK NULL |
| waste_type | varchar(16) |
| confidence | double precision CHECK 0~1 |
| image_reference | text NULL |
| detected_at | timestamptz |

## 초기 시드
DEVICE_001 + BIN_001(plastic), BIN_002(can), BIN_003(paper), BIN_004(general). 보정값은 **NULL**로 두고 실측 후 API로 설정한다.
