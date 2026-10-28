# 메타버스 병원 공간 데이터 구조 및 API 기획서

## 목적

메타버스 뷰어가 병원 건물을 3D/2D로 렌더링하기 위한 **공간 데이터 구조**와 이를 관리·조회하는 **API**를 정의합니다.

## 공간 계층 구조

```
Hospital (병원)
└── Building (동)
    └── Floor (층)
        └── Wing (구역/날개)
            └── Zone (공간)
                └── Spot (지점)

예시:
Hospital RUN
└── 본관
    ├── 1F
    │   ├── 로비 구역
    │   │   ├── 정문 출입구
    │   │   ├── 안내 데스크
    │   │   └── 엘리베이터 홀
    │   ├── 접수/원무 구역
    │   │   ├── 접수 창구 1~4
    │   │   ├── 수납 창구 1~3
    │   │   └── 서류 발급기
    │   ├── 응급 구역
    │   │   ├── 응급실 입구
    │   │   ├── 트리아지 데스크
    │   │   ├── 응급 치료실 (ER-01 ~ ER-05)
    │   │   ├── 응급 처치실
    │   │   └── 응급 관찰실
    │   ├── 수술 구역
    │   │   ├── 수술실 1 (OR-1)
    │   │   ├── 수술실 2 (OR-2)
    │   │   ├── 회복실
    │   │   └── 수술 대기실
    │   └── 편의 구역
    │       ├── 약국
    │       ├── 편의점
    │       ├── 카페
    │       └── ATM
    ├── 2F (외래)
    │   ├── 내과 구역
    │   │   ├── 내과 대기실
    │   │   ├── 내과 1진료실 (201)
    │   │   ├── 내과 2진료실 (202)
    │   │   ├── 내과 3진료실 (203)
    │   │   └── 내과 간호스테이션
    │   ├── 외과 구역
    │   │   ├── 외과 대기실
    │   │   ├── 외과 1진료실 (204)
    │   │   └── 외과 간호스테이션
    │   ├── 소아/산부 구역
    │   │   ├── 소아과 진료실 (205)
    │   │   ├── 산부인과 진료실 (206)
    │   │   └── 수유실
    │   ├── 전문과 구역
    │   │   ├── 정형외과 (207)
    │   │   ├── 이비인후과 (208)
    │   │   ├── 안과 (209)
    │   │   ├── 피부과 (210)
    │   │   └── 정신건강의학과 (211)
    │   ├── 검사 구역
    │   │   ├── 채혈실
    │   │   ├── 검체 접수
    │   │   ├── 심전도실 (EKG)
    │   │   ├── 폐기능검사실 (PFT)
    │   │   └── 뇌파검사실 (EEG)
    │   ├── 영상 구역
    │   │   ├── X-ray실 1~2
    │   │   ├── CT실
    │   │   ├── MRI실
    │   │   ├── 초음파실 1~2
    │   │   └── 내시경실
    │   └── 공용
    │       ├── 엘리베이터 홀
    │       ├── 화장실 (남/여)
    │       └── 자동판매기
    ├── 3F (내과병동)
    │   ├── 간호스테이션
    │   ├── 301호 (A, B)
    │   ├── 302호 (A, B)
    │   ├── 303호 (A, B)
    │   ├── 304호 (A, B)
    │   ├── 305호 (A, B)
    │   ├── 처치실
    │   ├── 린넨실
    │   ├── 탕비실
    │   └── 화장실/샤워실
    ├── 4F (외과병동) — 3F와 동일 구조
    ├── 5F (소아/산부병동) — 501~503
    ├── 6F (정형외과병동) — 601~603
    └── B1 (지하)
        ├── 중앙공급실 (CSSD)
        ├── 의료폐기물 처리실
        ├── 세탁실
        ├── 급식실/주방
        ├── 영안실
        └── 기계실
```

## 데이터 모델

### SpaceNode (공간 노드) — 모든 공간의 통합 모델

```prisma
model SpaceNode {
  id          String  @id @default(uuid()) @db.Uuid
  
  // ── 계층 구조 ──
  parentId    String? @map("parent_id") @db.Uuid
  depth       Int     @default(0)           // 0=Hospital, 1=Building, 2=Floor, 3=Wing, 4=Zone, 5=Spot
  path        String  @db.VarChar(500)      // "본관/1F/응급 구역/ER-01" (빠른 조회용)
  
  // ── 기본 정보 ──
  nodeType    String  @map("node_type") @db.VarChar(30)
  // HOSPITAL, BUILDING, FLOOR, WING, ZONE, SPOT
  name        String  @db.VarChar(100)      // "내과 1진료실"
  nameEn      String? @map("name_en") @db.VarChar(100) // "IM Clinic 1"
  code        String? @unique @db.VarChar(30) // "F2-IM-201" (고유 공간 코드)
  
  // ── 위치/공간 ──
  floor       Int?                          // 층 (-1=B1, 1~6)
  roomNumber  String? @map("room_number") @db.VarChar(20)
  
  // ── 기능 분류 ──
  spaceType   String  @map("space_type") @db.VarChar(30)
  // LOBBY, ENTRANCE, DESK, RECEPTION, CASHIER,
  // WAITING, CLINIC, NURSE_STATION,
  // LAB, IMAGING, ENDOSCOPY, EKG, PFT, EEG,
  // PHARMACY, 
  // WARD_ROOM, WARD_BED, TREATMENT_ROOM,
  // SURGERY, RECOVERY, 
  // ER, ER_BED, TRIAGE, ER_TREATMENT,
  // ICU, ICU_BED,
  // CSSD, KITCHEN, LAUNDRY, MORGUE, MECHANICAL,
  // ELEVATOR, STAIR, RESTROOM, SHOWER,
  // CAFETERIA, CONVENIENCE, ATM,
  // STORAGE, OFFICE, CONFERENCE, CHAPEL
  
  department  String? @db.VarChar(50)       // "내과", "외과", "응급의학과"
  
  // ── 수용/용량 ──
  capacity    Int?                          // 수용 인원
  
  // ── 3D/2D 렌더링 ──
  position    Json?   @db.JsonB             // { x, y, z } 3D 좌표 (미터 단위)
  size        Json?   @db.JsonB             // { width, height, depth } 공간 크기
  rotation    Json?   @db.JsonB             // { rx, ry, rz } 회전 (도)
  bounds2d    Json?   @map("bounds_2d") @db.JsonB  // { x, y, w, h } 2D 평면도 좌표 (픽셀)
  
  // ── 시각 속성 ──
  color       String? @db.VarChar(7)        // "#3B82F6" 구역 색상
  icon        String? @db.VarChar(30)       // "clinic", "lab", "er" 아이콘 키
  modelUrl    String? @map("model_url") @db.VarChar(500) // 3D 모델 URL (.glb)
  textureUrl  String? @map("texture_url") @db.VarChar(500) // 바닥/벽 텍스처
  
  // ── 연결 ──
  wardId      String? @map("ward_id") @db.Uuid     // Ward 테이블 연결
  bedId       String? @map("bed_id") @db.Uuid       // Bed 테이블 연결
  
  // ── 인접/경로 ──
  connectedTo Json?   @map("connected_to") @db.JsonB // ["node-id-1", "node-id-2"] 인접 노드
  walkTime    Int?    @map("walk_time")              // 이전 노드에서 도보 시간 (초)
  
  // ── 상태 ──
  isActive    Boolean @default(true) @map("is_active")
  isPublic    Boolean @default(true) @map("is_public") // 환자에게 노출 여부
  sortOrder   Int     @default(0)   @map("sort_order")
  
  // ── 메타데이터 ──
  equipment   Json?   @db.JsonB             // 장비 목록 [{ name, model, count }]
  tags        Json?   @db.JsonB             // ["wheelchair-accessible", "oxygen-line"]
  operatingHours Json? @map("operating_hours") @db.JsonB // { weekday: "09:00-18:00", weekend: "closed" }
  metadata    Json?   @db.JsonB             // 기타 확장 속성
  
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz()
  
  // ── 자기참조 ──
  parent      SpaceNode?  @relation("SpaceTree", fields: [parentId], references: [id])
  children    SpaceNode[] @relation("SpaceTree")
  
  @@index([parentId])
  @@index([floor])
  @@index([spaceType])
  @@index([department])
  @@index([path])
  @@map("space_nodes")
}
```

## API 설계

### 1. 전체 병원 구조 트리

```
GET /api/v1/metaverse/space/tree
```

전체 공간 트리를 한 번에 반환. 뷰어 초기 로드용.

```json
{
  "data": {
    "id": "root",
    "nodeType": "HOSPITAL",
    "name": "Hospital RUN",
    "children": [
      {
        "id": "bldg-1",
        "nodeType": "BUILDING",
        "name": "본관",
        "children": [
          {
            "id": "f1",
            "nodeType": "FLOOR",
            "name": "1층",
            "floor": 1,
            "children": [
              {
                "id": "w1-lobby",
                "nodeType": "WING",
                "name": "로비 구역",
                "color": "#E5E7EB",
                "bounds2d": { "x": 0, "y": 0, "w": 300, "h": 150 },
                "children": [
                  { "id": "z1-entrance", "nodeType": "ZONE", "name": "정문 출입구", "spaceType": "ENTRANCE", "icon": "door", "position": { "x": 0, "y": 0, "z": 0 }, "size": { "w": 6, "h": 3, "d": 4 } },
                  { "id": "z1-info", "nodeType": "ZONE", "name": "안내 데스크", "spaceType": "DESK", "icon": "info", "capacity": 2 },
                  { "id": "z1-elev", "nodeType": "ZONE", "name": "엘리베이터 홀", "spaceType": "ELEVATOR", "icon": "elevator", "connectedTo": ["f2-elev", "f3-elev"] }
                ]
              },
              {
                "id": "w1-er",
                "nodeType": "WING",
                "name": "응급 구역",
                "color": "#FEE2E2",
                "children": [
                  { "id": "z1-er-entrance", "nodeType": "ZONE", "name": "응급실 입구", "spaceType": "ENTRANCE" },
                  { "id": "z1-triage", "nodeType": "ZONE", "name": "트리아지", "spaceType": "TRIAGE", "capacity": 2 },
                  { "id": "z1-er01", "nodeType": "ZONE", "name": "ER-01", "spaceType": "ER_BED", "roomNumber": "ER-01", "capacity": 1 },
                  { "id": "z1-er02", "nodeType": "ZONE", "name": "ER-02", "spaceType": "ER_BED", "roomNumber": "ER-02", "capacity": 1 }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### 2. 특정 층 상세

```
GET /api/v1/metaverse/space/floor/:floor
```

```json
{
  "data": {
    "floor": 2,
    "name": "2층 외래",
    "wings": [
      {
        "id": "w2-im",
        "name": "내과 구역",
        "department": "내과",
        "color": "#DBEAFE",
        "bounds2d": { "x": 0, "y": 0, "w": 400, "h": 200 },
        "zones": [
          { "id": "z2-im-wait", "name": "내과 대기실", "spaceType": "WAITING", "capacity": 30, "bounds2d": { "x": 10, "y": 10, "w": 120, "h": 80 } },
          { "id": "z2-im-201", "name": "내과 1진료실", "spaceType": "CLINIC", "code": "F2-IM-201", "roomNumber": "201", "capacity": 3, "bounds2d": { "x": 140, "y": 10, "w": 60, "h": 50 }, "equipment": [{ "name": "진료 침대", "count": 1 }, { "name": "혈압계", "count": 1 }] },
          { "id": "z2-im-202", "name": "내과 2진료실", "spaceType": "CLINIC", "code": "F2-IM-202", "roomNumber": "202" },
          { "id": "z2-im-ns", "name": "내과 간호스테이션", "spaceType": "NURSE_STATION" }
        ]
      },
      {
        "id": "w2-lab",
        "name": "검사 구역",
        "color": "#FEF3C7",
        "zones": [
          { "id": "z2-blood", "name": "채혈실", "spaceType": "LAB", "capacity": 6, "equipment": [{ "name": "채혈 의자", "count": 6 }] },
          { "id": "z2-ekg", "name": "심전도실", "spaceType": "EKG", "capacity": 2 },
          { "id": "z2-pft", "name": "폐기능검사실", "spaceType": "PFT", "capacity": 1 }
        ]
      }
    ],
    "shared": [
      { "id": "z2-elev", "name": "엘리베이터 홀", "spaceType": "ELEVATOR" },
      { "id": "z2-wc-m", "name": "남자 화장실", "spaceType": "RESTROOM" },
      { "id": "z2-wc-f", "name": "여자 화장실", "spaceType": "RESTROOM" }
    ]
  }
}
```

### 3. 개별 공간 상세

```
GET /api/v1/metaverse/space/node/:id
```

```json
{
  "data": {
    "id": "z2-im-201",
    "nodeType": "ZONE",
    "name": "내과 1진료실",
    "nameEn": "IM Clinic 1",
    "code": "F2-IM-201",
    "spaceType": "CLINIC",
    "floor": 2,
    "roomNumber": "201",
    "department": "내과",
    "capacity": 3,
    "path": "본관/2F/내과 구역/내과 1진료실",
    "parent": { "id": "w2-im", "name": "내과 구역" },
    "position": { "x": 14.0, "y": 0, "z": 1.0 },
    "size": { "w": 4.0, "h": 2.8, "d": 3.5 },
    "bounds2d": { "x": 140, "y": 10, "w": 60, "h": 50 },
    "color": "#3B82F6",
    "icon": "clinic",
    "connectedTo": ["z2-im-wait", "z2-im-ns", "z2-corridor"],
    "walkTime": 15,
    "equipment": [
      { "name": "진료 침대", "model": "standard", "count": 1 },
      { "name": "전자혈압계", "model": "Omron-HEM", "count": 1 },
      { "name": "이경/안저경 세트", "count": 1 },
      { "name": "PC + 모니터", "count": 1 }
    ],
    "tags": ["wheelchair-accessible"],
    "operatingHours": { "weekday": "09:00-18:00", "saturday": "09:00-13:00", "sunday": "closed" },
    "isPublic": true,
    "isActive": true,
    "currentOccupancy": 2
  }
}
```

### 4. 공간 유형별 조회

```
GET /api/v1/metaverse/space/by-type/:spaceType
GET /api/v1/metaverse/space/by-type/CLINIC
GET /api/v1/metaverse/space/by-type/ER_BED
GET /api/v1/metaverse/space/by-type/SURGERY
```

```json
{
  "data": [
    { "id": "z2-im-201", "name": "내과 1진료실", "code": "F2-IM-201", "floor": 2, "department": "내과", "capacity": 3 },
    { "id": "z2-im-202", "name": "내과 2진료실", "code": "F2-IM-202", "floor": 2, "department": "내과", "capacity": 3 },
    { "id": "z2-sg-204", "name": "외과 1진료실", "code": "F2-SG-204", "floor": 2, "department": "외과", "capacity": 3 }
  ]
}
```

### 5. 경로 탐색 (두 공간 사이 이동 경로)

```
GET /api/v1/metaverse/space/route?from=z1-entrance&to=z2-im-201
```

```json
{
  "data": {
    "from": { "id": "z1-entrance", "name": "정문 출입구", "floor": 1 },
    "to": { "id": "z2-im-201", "name": "내과 1진료실", "floor": 2 },
    "route": [
      { "nodeId": "z1-entrance", "name": "정문 출입구", "floor": 1, "action": "START" },
      { "nodeId": "z1-lobby", "name": "로비", "floor": 1, "action": "WALK", "walkTime": 10 },
      { "nodeId": "z1-elev", "name": "엘리베이터 홀", "floor": 1, "action": "WALK", "walkTime": 15 },
      { "nodeId": "z2-elev", "name": "엘리베이터 홀", "floor": 2, "action": "ELEVATOR", "walkTime": 30 },
      { "nodeId": "z2-im-wait", "name": "내과 대기실", "floor": 2, "action": "WALK", "walkTime": 10 },
      { "nodeId": "z2-im-201", "name": "내과 1진료실", "floor": 2, "action": "ARRIVE", "walkTime": 5 }
    ],
    "totalWalkTime": 70,
    "floorsTraversed": [1, 2],
    "elevatorUsed": true
  }
}
```

### 6. 공간 관리 CRUD (관리자)

```
POST   /api/v1/metaverse/space/nodes              — 공간 추가
PUT    /api/v1/metaverse/space/nodes/:id           — 공간 수정
DELETE /api/v1/metaverse/space/nodes/:id           — 공간 삭제
PATCH  /api/v1/metaverse/space/nodes/:id/position  — 좌표/크기만 수정
POST   /api/v1/metaverse/space/bulk-import         — 일괄 등록 (JSON)
POST   /api/v1/metaverse/space/bulk-export         — 전체 구조 JSON 내보내기
```

### 7. 병동↔공간 동기화

```
POST /api/v1/metaverse/space/sync-wards
```
기존 Ward/Bed 데이터를 SpaceNode로 자동 동기화.

```json
{
  "data": {
    "synced": { "wards": 5, "beds": 31 },
    "created": 36,
    "updated": 0
  }
}
```

## spaceType 코드표

| 코드 | 한글명 | 3D 기본 모델 | 아이콘 |
|------|--------|------------|--------|
| HOSPITAL | 병원 | — | hospital |
| BUILDING | 건물(동) | building.glb | building |
| FLOOR | 층 | — | layers |
| WING | 구역/날개 | — | layout |
| LOBBY | 로비 | — | door-open |
| ENTRANCE | 출입구 | door.glb | door |
| DESK | 안내/데스크 | desk.glb | info |
| RECEPTION | 접수 창구 | counter.glb | clipboard |
| CASHIER | 수납 창구 | counter.glb | credit-card |
| WAITING | 대기실 | waiting-room.glb | clock |
| CLINIC | 진료실 | clinic.glb | stethoscope |
| NURSE_STATION | 간호스테이션 | nurse-station.glb | heart-pulse |
| LAB | 검사실/채혈실 | lab.glb | flask |
| EKG | 심전도실 | ekg-room.glb | activity |
| PFT | 폐기능검사실 | — | wind |
| EEG | 뇌파검사실 | — | brain |
| IMAGING | 영상실 (X-ray/CT/MRI) | imaging.glb | scan |
| ENDOSCOPY | 내시경실 | — | eye |
| ULTRASOUND | 초음파실 | — | radio |
| PHARMACY | 약국 | pharmacy.glb | pill |
| WARD_ROOM | 병실 | ward-room.glb | bed |
| WARD_BED | 병상 (개별) | bed.glb | bed |
| TREATMENT_ROOM | 처치실 | — | syringe |
| SURGERY | 수술실 | surgery.glb | scissors |
| RECOVERY | 회복실 | — | heart |
| ER | 응급실 (전체) | er.glb | alert-triangle |
| ER_BED | 응급실 침대 | er-bed.glb | bed |
| TRIAGE | 트리아지 데스크 | — | clipboard-check |
| ER_TREATMENT | 응급 처치실 | — | zap |
| ICU | 중환자실 (전체) | icu.glb | monitor |
| ICU_BED | ICU 침대 | icu-bed.glb | bed |
| CSSD | 중앙공급실 | — | flame |
| KITCHEN | 급식실/주방 | — | utensils |
| LAUNDRY | 세탁실 | — | shirt |
| MORGUE | 영안실 | — | — |
| MECHANICAL | 기계실 | — | settings |
| ELEVATOR | 엘리베이터 | elevator.glb | arrow-up-down |
| STAIR | 계단 | stair.glb | trending-up |
| RESTROOM | 화장실 | — | droplet |
| SHOWER | 샤워실 | — | shower |
| CAFETERIA | 식당/카페 | — | coffee |
| CONVENIENCE | 편의점 | — | shopping-bag |
| ATM | ATM | — | banknote |
| STORAGE | 창고/린넨실 | — | archive |
| OFFICE | 사무실 | — | briefcase |
| CONFERENCE | 회의실 | — | users |
| CHAPEL | 기도실 | — | — |

## 공간 코드 체계

```
{건물코드}-{층코드}-{구역코드}-{공간번호}

예시:
M-F1-LB-001    본관 1층 로비 정문출입구
M-F1-ER-001    본관 1층 응급실 ER-01
M-F2-IM-201    본관 2층 내과 201진료실
M-F2-LB-001    본관 2층 채혈실
M-F3-WD-301A   본관 3층 내과병동 301호 A침대
M-F4-WD-401B   본관 4층 외과병동 401호 B침대
M-B1-CS-001    본관 지하1층 중앙공급실
```

## API 요약

| Method | Endpoint | 용도 |
|--------|----------|------|
| GET | /metaverse/space/tree | 전체 병원 트리 구조 |
| GET | /metaverse/space/floor/:floor | 특정 층 상세 |
| GET | /metaverse/space/node/:id | 개별 공간 상세 |
| GET | /metaverse/space/by-type/:type | 유형별 공간 목록 |
| GET | /metaverse/space/route | 두 공간 사이 경로 |
| POST | /metaverse/space/nodes | 공간 추가 |
| PUT | /metaverse/space/nodes/:id | 공간 수정 |
| DELETE | /metaverse/space/nodes/:id | 공간 삭제 |
| PATCH | /metaverse/space/nodes/:id/position | 좌표만 수정 |
| POST | /metaverse/space/bulk-import | 일괄 등록 |
| POST | /metaverse/space/bulk-export | 전체 내보내기 |
| POST | /metaverse/space/sync-wards | Ward/Bed 동기화 |

## 구현 단계

### Phase 1: 스키마 + 핵심 조회
1. SpaceNode 테이블 생성 (Prisma)
2. 병원 구조 seed 데이터 (1~6층 + B1, 약 80개 노드)
3. Ward/Bed → SpaceNode 동기화 API
4. GET /tree, GET /floor/:floor, GET /node/:id API

### Phase 2: 관리 + 경로
5. 공간 CRUD API
6. 일괄 등록/내보내기
7. 경로 탐색 API (BFS 기반)
8. 좌표 편집 API

### Phase 3: 3D 자산 연동
9. modelUrl/textureUrl 필드 활용
10. 3D 모델 업로드/관리 API
11. 뷰어 연동 테스트
