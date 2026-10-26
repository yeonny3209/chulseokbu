# 출석부 (Roll Call) — 프로젝트 규칙

1인칭 3D 추격·생존 공포 웹게임. 기획서: `../게임기획서_출석부.md`

## 기술 스택
- Three.js (WebGL) + Vite, 순수 JavaScript (ES modules). 빌드 결과는 정적 파일 → GitHub Pages / itch.io 에 올리면 됨.
- 이미지·소리 파일 없음: 텍스처는 Canvas, 효과음은 Web Audio, 선생님 목소리는 브라우저 TTS(임시).

## 폴더 구조 (`src/`)
| 파일 | 역할 |
|---|---|
| `config.js` | **모든 조절 수치** (속도, 소음 반경, 감지 거리, 난이도, 그래픽 품질) |
| `story.js` | 쪽지 12개·방송 대사·출석 대사·목표·힌트 텍스트 |
| `layout.js` | 학교 구조(층/방 배치), 시작 위치, 숨는 사물함 위치 |
| `world.js` | 벽·바닥·계단·문·조명 생성, 충돌/지면/시야선(LOS) 질의 |
| `rooms.js` | 방별 가구, 숨는 곳, 아이템, 쪽지, 퍼즐 오브젝트 배치 |
| `nav.js` | 선생님 길찾기용 웨이포인트 그래프 + A* (계단 포함) |
| `teacher.js` | 선생님 모델 + AI 상태기계 (순찰/의심/수색/추격/기절/잡기/연출) |
| `player.js` | 이동, 손전등, 숨기, 던지기, 상호작용 |
| `events.js` | 줍기, 퍼즐, 점프스케어 배치, 체크포인트, 마지막 추격, 트리거 |
| `scares.js` | 점프스케어 연출 3종: `advance`(불이 깜빡일 때마다 가까워짐→폭발), `behind`(등 뒤 숨소리→강제로 뒤돌아봄), `slam`(즉시 폭발). 소리 끊김·비명·저음·얼굴 슬램·귀 울림까지 포함 |
| `ending.js` | 반전 엔딩 연출 |
| `audio.js` | 효과음 합성, 위치 기반 소리, TTS |
| `ui.js` / `style.css` / `index.html` | HUD, 메뉴, 쪽지, 다이얼, 설정 |
| `state.js` | 저장되는 진행 상태 `S`, 설정, localStorage |
| `main.js` | 렌더러·후처리·메인 루프·메뉴 흐름 |

## 멀티플레이 (최대 6명) 구조
- `src/net/transport.js` 연결(PeerJS WebRTC / 테스트용 BroadcastChannel `?net=local`), `net/net.js` 방·메시지·동기화, `net/remote.js` 다른 플레이어(아바타·손전등).
- **방장이 이야기 전체를 계산한다**(선생님 AI, 퍼즐, 점프스케어, 체크포인트). 참가자는 자기 캐릭터만 움직이고 위치를 15Hz로 방장에게 보낸다. 방장은 15Hz로 `snap`(플레이어들+선생님)과 `shared`(진행 상태)를 뿌린다.
- 공유 상태는 `state.js` 의 `SHARED_KEYS` 만 (flags, keys, collected, doorOpen, doorUnlocked, objective, stage, deaths). 배터리·든 물건·읽은 쪽지는 각자 것.
- 공유 상태를 바꾸는 행동은 반드시 `events.act('이름', 데이터)` → 방장의 `hostAct`. 직접 `S.flags.x = ...` 하지 말 것(참가자 화면에서는 무시됨).
- 모두가 보고 들어야 하는 효과는 `game.rpc('이름', ...)`, 한 사람에게만은 `game.rpcTo(id, '이름', ...)`. 이름은 `main.js` 의 `RPC` 표에 등록.
- 선생님은 `game.allPlayers()` 의 모든 플레이어를 본다. 새 플레이어 속성이 필요하면 `Player`와 `RemotePlayer` 양쪽에 같은 이름으로 만든다(`pos, hidden, flashOn, focus, holding, downed, invuln, eye(), forward()`).
- 혼자 하기(solo)는 같은 코드가 `role === 'solo'` 로 돈다. 혼자 하기가 깨지지 않았는지 항상 같이 확인.

## 점프스케어 만들기
- 새 연출은 `events.js` 에서 `hostScare(플레이어, 'advance'|'behind'|'slam', {d: 거리})` 로 부른다(호스트가 해당 플레이어에게만 RPC `scare` 전송). 여러 명이 가까이 있으면 `scareNear(x, y, 반경, 종류, 값)`.
- 같은 연출을 두 번 보이지 않게 `S.flags['sc_...']` 로 한 번만. 추격 중·숨은 중·쓰러진 중에는 `hostScare` 가 자동으로 건너뛴다.
- 화면 효과는 `game.scareFx(세기)`(흔들림·시야각 튐·색 번짐·심장), 얼굴은 `ui.faceSlam()`, 소리는 `audio.duck()`(정적) → `play(..., {bus:'sting'})` → `audio.muffle()`/`ringing()`(귀 울림).
- 설정의 "화면 흔들림 줄이기"가 켜져 있으면 번쩍임·흔들림·시야각 튐이 약해진다. 새 연출도 이 설정을 존중할 것.

## 작업 규칙
- 숫자(속도, 반경, 시간)는 코드에 직접 쓰지 말고 `config.js` 에 둔다.
- 글(대사, 쪽지)은 `story.js` 에 둔다.
- 좌표계: x = 복도 방향(0~72), z = 폭 방향(복도 0~3, 교실 3~11), y = 높이. 층 높이 3.5m. 1층 y=0, 2층 y=3.5, 3층 y=7.
- 플레이어 시작: 2층(y=3.5) 2-3반. 층 인덱스: 0=1층, 1=2층, 2=3층.
- 진행 상태는 전부 `S`(state.js)에 넣어야 체크포인트 저장/복구가 된다. 새 플래그는 `S.flags.xxx`.
- 기능 하나가 작동하면 바로 git 커밋.

## 디버그
- 개발 서버: `npm run dev` → http://localhost:5173
- 게임 중 `F1`: 위치·선생님 상태·공포 수치 표시.
- 브라우저 콘솔: `__g`(게임), `__S`(진행 상태). 예) `__g.player.teleport(x, y, z, yaw)`, `__g.events.checkpoint('test')`.

## 알려진 한계 / 다음 작업 후보
- Blender 모델은 아직 쓰지 않음(학교를 코드로 생성). Blender 로 만든 `.glb` 를 불러오려면 `world.js` 의 `build()` 대신 GLTFLoader 로 교체하고, 빈 오브젝트 이름 규칙(`spawn_`, `hide_`, `patrol_`)을 읽도록 확장.
- 선생님 목소리는 TTS 임시. 실제 녹음 파일은 `public/sounds/` 에 넣고 `audio.js` 에서 불러오게 확장.
- 휴대폰은 `src/touch.js` 의 화면 조작(조이스틱·시점·버튼)이 키보드와 같은 `Input` 에 값을 넣는 방식. 새 조작 키를 만들면 touch.js 에 버튼도 추가할 것. 실제 기기에서의 성능·조작감은 사람이 확인해야 함.
- 멀티플레이: 중간 입장·재접속 미지원, 방장이 나가면 게임 종료, 음성 채팅 없음. 서로 다른 네트워크 실제 환경(TURN 중계 포함)은 사람이 직접 확인해야 함.
