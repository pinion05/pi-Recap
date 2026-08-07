<p align="center">
  <img src="assets/recap.jpeg" width="720" alt="pi-Recap">
</p>

<h3 align="center">컨텍스트를 공유하는 familiar가 모든 툴 결과를 1–3줄로 요약합니다. 오래된 결과는 recap으로 조용히 교체되며, 언제든 원본을 복구할 수 있습니다.</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap"><img src="https://img.shields.io/npm/v/@npmc_5/pi-recap?color=cb3837&label=npm"></a>
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap"><img src="https://img.shields.io/npm/dt/@npmc_5/pi-recap?color=cb3837&label=downloads"></a>
  <img src="https://img.shields.io/npm/l/@npmc_5/pi-recap?color=blue">
  <img src="https://img.shields.io/node/v/@npmc_5/pi-recap?color=339933">
  <img src="https://img.shields.io/badge/pi-extension-7c3aed">
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>한국어</b> ·
  <a href="#install"><b>설치</b></a> ·
  <a href="https://www.npmjs.com/package/@npmc_5/pi-recap">npm</a> ·
  <a href="#성능-측정">벤치마크</a> ·
  <a href="#명령어">문서</a> ·
  <a href="#설정">설정</a>
</p>

[Pi](https://github.com/badlogic/pi-mono) 확장입니다. 메인 에이전트가 작업하는 동안, 모든 툴 결과(`read`, `bash`, `rg`, 웹 fetch 등)는 **familiar**(메인 에이전트의 전체 컨텍스트와 모델을 공유하는 LLM 호출)가 작성한 작은 recap을 받습니다. 몇 턴 뒤, 컨텍스트에 들어있던 긴 원본은 조용히 recap으로 교체됩니다. 다시 자세한 내용이 필요해지면 `recap_recover`로 원본을 불러올 수 있습니다.

---

## 동작 방식

```
툴 결과 도착
   │
   ▼
┌──────────────────────────────────────────────┐
│ FAMILIAR (같은 모델, 같은 컨텍스트 prefix)    │
│  "툴 결과 <id>를 1–3줄로 요약"                │
│  → recapText                                 │
└──────────────────────────────────────────────┘
   │  (공유 prefix → prefix-cache hit;
   │   메인 에이전트의 다음 호출 캐시도 예열)
   ▼
recap을 세션 인덱스에 저장 (원본은 보존)

…swapTurnThreshold 턴이 지난 뒤…
   │
   ▼
┌──────────────────────────────────────────────┐
│ 컨텍스트 이벤트: 오래된 툴 결과               │
│   조용히 <recap>으로 교체                     │
│   [recap_recover: rN]                        │
└──────────────────────────────────────────────┘
```

### 왜 familiar가 메인 컨텍스트와 모델을 공유하는가

- **같은 컨텍스트** → recap이 현재 작업이 실제로 신경 쓰는 것을 압니다(단순한 "이걸 요약해"가 아닙니다).
- **같은 모델 + 같은 prefix** → familiar의 입력이 제공자의 **prefix cache**에 적중합니다. 공유 컨텍스트는 cache-read 요율로 과금되고, 이 호출이 메인 에이전트의 다음 요청 캐시도 함께 예열합니다.
- **결과별, 즉시** → 각 툴 결과는 나타나자마자 한 번씩 recap됩니다. 그래서 스왑 임계값에 도달할 때면 항상 recap이 준비되어 있습니다.

### "은밀한" 스왑

메인 에이전트는 스왑이 일어났다는 사실을 알지 못합니다 — 그저 툴 결과 메시지가 더 짧아졌을 뿐입니다. 교체된 각 결과에는, 자세한 내용이 다시 필요할 때 에이전트가 행동할 수 있는 작은 마커가 붙습니다:

```
〈recap〉 src/index.ts exists (1340 LOC, TypeScript). Exports default
extension entry wiring session_start/turn_end/context events.
[recap_recover: r12]
```

---

## 성능 측정

아래 수치는 실제 코딩 세션 하나(pi-Recap 디버깅 세션 자체)에서 나왔습니다. 세션 로그의 각 `recap-entry`는 `originalText`와 `recapText`를 **모두** 가지고 있어, 압축률을 정확히 측정합니다 — 추정이 아닙니다. 카운트는 0.1.3 동작을 기준으로 합니다 — 200자 미만 결과는 건너뛰어, recap 대상인 63개 결과만 셉니다. 의미 보존 여부는 대표 사례에 대한 정성 평가입니다.

### Vanilla vs pi-Recap (정적 시뮬레이션)

이 세션의 실제 툴 결과 시퀀스를 그대로 쓴 통제 비교입니다: **vanilla**는 모든 결과를 원본으로 유지하고, **pi-Recap**은 스왑 임계값을 넘긴 결과를 recap으로 교체합니다. 토큰은 tiktoken(`cl100k_base`)으로 측정했습니다.

| 지표 | Vanilla | pi-Recap | 절감 |
|---|---|---|---|
| 메인 컨텍스트 툴 결과 토큰 (세션 종료 시 누적) | 75,554 | 7,041 | **90.7%** (−68,513) |
| 세션 50% 지점 | 60,041 | 3,763 | 93.7% |
| 세션 25% 지점 | 29,228 | 3,508 | 88.0% |

절감은 세션이 길어질수록 누적됩니다 — 중간쯤 가면 vanilla 곡선이 이미 pi-Recap 곡선의 약 16배입니다.

> ⚠️ **범위.** 90.7%는 **메인 컨텍스트 윈도우** 절감량입니다 — 긴 세션이 컨텍스트 한계에 부딪히지 않게 해줍니다. 청구되는 총 토큰이 아닙니다: familiar가 자체 호출을 추가합니다(여기서 100회 recap, 출력 7,616 토큰). familiar의 **입력** 토큰은 로깅되지 않아(메인 호출의 `outputTokens`만 추적), 순비용은 실제 A/B가 필요합니다. 이 시뮬레이션이 답하는 질문은 "pi-Recap이 컨텍스트를 얼마나 비워주는가?" — 답: **90.7%**.

### 결과 크기별 압축률

| 원본 크기 | 개수 | 평균 압축률 |
|---|---|---|
| < 200자 | — | *0.1.3부터 건너뜀* (recap이 원본보다 길어짐) |
| 200–1K | 34 | 49% |
| 1K–5K | 24 | 86% |
| 5K–20K | 3 | 96% |
| > 20K | 2 | 99% |
| **전체 (≥200)** | **63** | **92.1%** (204K → 16K자 ≈ 50.9K → 4.0K 토큰) |

recap은 입력 크기와 무관하게 1–3줄로 평평하기 때문에, 원본이 클수록 절감 효과가 극적입니다. 200자 미만 결과는 아예 건너뜁니다 — 요약이 원본보다 길어져, recap하는 게 토큰을 절감하는 게 아니라 오히려 쓰게 만들기 때문입니다.

### 대규모 실측 — 226-recap 실제 세션

더 긴 실제 세션(2.5 MB 로그, pi-Recap 개발 세션)이 `<200`-skip 도입 이전 코드로 돌아가, 그 로그는 *모든* 툴 결과를 기록합니다 — 0.1.3 skip이 이제 제외하는 짧은 결과까지. 대규모의 가장 좋은 "이전(before)" 그림입니다: 226개 recap 생성, 127개가 이후 컨텍스트에 주입. 토큰은 tiktoken(`cl100k_base`)으로 측정.

| 지표 | 값 |
|---|---|
| 생성 / 주입된 recap | 226 / 127 |
| 스왑 대상 (recap이 원본보다 짧음) | **130 / 226 = 58%** |
| 스왑 대상 결과의 토큰 | 79,762 → 13,793 — **65,969 절감 (83.9%)** |
| 역압축 (recap ≥ 원본 → 스왑 안 됨) | **96 / 226 = 42%** |
| 복구 툴 호출 | **0 / 127** (모든 recap이 충분했음) |

**도구별 (문자 압축률):**

| 도구 | n | 압축률 |
|---|---|---|
| `read` | 13 | 92.6% |
| `web_search` | 7 | 82.7% |
| `source_check` | 1 | 76.5% |
| `fetch_content` | 5 | 72.6% |
| `bash` | 186 | 68.4% |
| `edit` | 8 | **−169%** |
| `write` | 6 | **−413%** |

이 세션에서 나온 두 발견이 로드맵을 정했습니다:

1. **`<200`자 skip(0.1.3)은 타당합니다.** skip 이전 코드에서 60개의 200자 미만 결과도 recap되었고, 거의 전부 역압축이었습니다 — 1줄짜리 확인 메시지(`Successfully wrote 2926 bytes`)의 recap이 원본보다 길어집니다. 이들을 건너뛰는 건 순수한 절감입니다.
2. **`edit`/`write`도 제외해야 합니다.** 이들의 recap은 전부 역압축이었습니다: 결과 자체가 이미 1줄 성공 메시지이기 때문입니다. 크기 임계값 다음의 자연스러운 다음 게이트는 도구 허용/거부 목록입니다.

**0/127 복구율**이 가장 강력한 품질 신호입니다: 긴 세션 내내 에이전트가 원본을 다시 꺼내야 했던 적이 단 한 번도 없었습니다. 출력은 대화 언어와 무관하게 영어가 압도적(~86%)입니다 — familiar 프롬프트가 영어이고 소스(코드, 로그)도 대부분 영어라서 — 이게 토큰 효율을 높게 유지합니다 (영어 ≈ 4자/토큰 vs 한국어 ≈ 1.5).

### 대표 사례

| Ref | 도구 | 원본 | Recap | 절감 | 의미 보존 |
|---|---|---|---|---|---|
| r3 | `bash` (`ls -la ~`) | 18,255자 (전체 디렉토리 목록) | 266자 ("no pi-recap dir; related paths: …") | 99% | ⚠️ 부분 — 경로는 잡았으나 전체 파일 목록은 손실 (복구 가능) |
| r33 | `bash` (`grep .d.ts`) | 51,323자 (타입 정의) | 226자 ("truncateHead returns TruncationResult{content,…}") | 100% | ✅ 핵심 팩트 정확 |
| r32 | `bash` (`grep -rn`) | 4,771자 | 189자 | 96% | ✅ 핵심 팩트 정확 |
| r26 | `bash` (에러) | 979자 (모듈 로드 에러) | 283자 ("require() failed …") | 71% | ✅ 원인 포착 |

**결론:** ~1K자 이상의 결과에 대해 familiar는 85–99%를 압축하면서 핵심 팩트를 보존합니다. 200자 미만 결과는 아예 건너뛰어, recap이 원본보다 길어지는 일이 없습니다.

### 이상적 사례 — 실제 raw→recap 3쌍

226-recap 세션에서 발췌. 각각 실제 툴 결과의 앞부분과, 그것을 대체한 recap 전문을 나란히 보여줍니다. 주목할 점 — 환경변수 이름, CLI 플래그, 점수, 날짜, 모델명 등 코딩 작업이 실제로 의존하는 식별자가 그대로 살아남습니다.

**`read` — ARC-AGI-3 설치 README (85.7% · 2,410→345자)**

원본 (앞부분):
```
# ARC-AGI-3 Benchmarking
## Quickstart
1. git clone https://github.com/arcprize/arc-agi-3-benchmarking.git
2. uv venv && uv sync
3. cp .env.example to .env
4. ARC_API_KEY=your_api_key_here   (from arcprize.org)
5. uv run main.py --game=ls20
… 총 2,410자
```

Recap:
> `.env.example` defines required env vars — `ARC_API_KEY` (from arcprize.org, needed to access games), `ARC_BASE_URL`, and LLM provider keys (e.g. `OPENROUTER_API_KEY`). README confirms: `uv venv && uv sync`, then run `uv run main.py --game=ls20 --config=openai-gpt-5-4-2026-03-05` for single game, or omit `--game` for all 25 games.

**`bash` — `harbor run --help` 출력 (96.6% · 6,561→226자)**

원본 (앞부분):
```
│ --agent,-a <name|module:Class>   a single spec is accepted.        │
│ --dataset,-d ...                 terminal-bench/terminal-bench-2-1 │
│ --mounts,--mount… <str>          JSON array of volume mounts for   │
│                                  the environment container         │
… 정렬된 도움말 표 총 6,561자 …
```

Recap:
> `harbor run` CLI fully mapped: agent via `-a <name|module:Class>`, dataset via `-d terminal-bench/terminal-bench-2-1`, single task via `-i <name>`, model via `-m`. Built-in agents include `pi` and `codex` but no `prime-agent`.

**`web_search` — ARC-AGI-3 리더보드 (88.1% · 1,517→181자)**

원본 (앞부분):
```
- ARC-AGI-3 score over 90 agent released 2025: No. The premise conflates ARC-AGI-1 with ARC-AGI-3…
- ARC-AGI-3 90점 이상 에이전트: 네. Tycho 100.0% (2026-07-29), Retrodict 99.9% (7-19), baseline1 99.0% (7-15)…
- ARC-AGI-3 leaderboard top score state of art agent: Top published ARC-AGI-3 agent…
… 총 1,517자 …
```

Recap:
> Top ARC-AGI-3 Public Demo agents: Tycho (100%), Retrodict (99.9%), baseline1 (99.0%). A "Prime Agent" reportedly self-reported 95.5%. Top agents use GPT-5.6/Claude Opus 5 harnesses.

이런 경우가 pi-Recap이 설계된 자리입니다 — 본문은 크지만 행동에 필요한 핵심은 작은, 텍스트 위주 결과. (200자 미만 결과나 `edit`/`write` 확인 메시지는, 위 대규모 표에서 본 것처럼 건너뛰거나 역압축입니다.)

### 의미 보존 (0.1.3 기준선)

압축은 의미가 살아남을 때만 의미가 있습니다. recap을 **작업 기반 재현율**로 평가했습니다: 각 툴 결과에 대해, 에이전트의 *직후 행동*이 실제로 중요했던 팩트를 정의하고, 그것이 recap에 살아남는지 검사합니다. ("원본의 얼마나 남았는가"가 아니라 "에이전트가 이어서 *사용한* 것의 얼마나 남았는가".) 같은 세션의 73개 recapped 결과에 대한 LLM-as-judge 평가입니다.

| 결과 크기 | 작업 기반 재현율 |
|---|---|
| 작음 (<1K) | **90.6%** |
| 중간 (1–5K) | 63.8% |
| 큼 (5K+) | **59.1%** |
| **전체** | **80.6%** (74.3% 완전 보존 · 12.6% 부분 · 13.1% 손실) |

**핵심 발견: 압축과 보존은 반대 방향으로 갑니다.** 토큰 압축은 가장 큰 결과에서 *가장 좋고*(99%), 의미 보존은 거기서 *가장 나쁩니다*(59%). 큰 출력(전체 디렉토리 목록, 큰 타입 정의, 긴 로그)은 1–3줄 recap이 담을 수 있는 것보다 더 많은 것을 담고 있습니다.

**무엇이 손실되는가:** 지배적인 실패 양상은 *정확한 식별자*를 떨어뜨리는 것입니다 — 파일 경로, 상수 이름, 함수 위치, 설정값. familiar는 개념은 잡지만 정확한 이름을 잃고, 그것이 코딩 작업이 의존하는 바로 그것입니다.

**알려진 맹점:** 이 지표는 에이전트가 *직접 사용*한 팩트만 평가합니다. *우연한* 가치를 놓칩니다 — 큰 로그가 겉으로 드러낸, 에이전트가 즉시 행동하지는 않았지만 나중에 도움이 됐을 유용한 디테일 말입니다. recap은 그런 것도 떨어뜨릴 수 있습니다. 두 간극(정확한 식별자 + 우연한 디테일) 모두 다음 familiar 프롬프트 개정의 대상입니다.

### 주의사항

- **단일 코딩 세션; 환경에 따라 다릅니다.** 압축은 툴 중심 코딩(많은 `ls` / `cat` / `grep` / 로그 덤프)에서 유리합니다. 작은 결과 위주의 세션은 이득이 적고, 역압축(순손실)이 될 수도 있습니다.

---

## 설치

```bash
pi install npm:@npmc_5/pi-recap     # 안정판
pi install git:github.com/pinion05/pi-Recap   # 최신
pi -e .                                      # 소스에서 바로 실행
```

그 다음:

```
/Recap on
```

## 명령어

| 명령어 | 효과 |
|---|---|
| `/Recap` | 대화형 서브커맨드 선택기 |
| `/Recap on` / `off` | 활성화 / 비활성화 |
| `/Recap status` | 상태, 임계값, recap 수, 현재 턴 |
| `/Recap threshold [n]` | 스왑 턴 임계값 표시 또는 설정 (기본 5) |
| `/Recap help` | 도움말 |

## 복구 툴

`recap_recover`는 항상 사용 가능합니다. 짧은 ref(`r12`) 또는 `toolCallId`를 넘기세요:

```
recap_recover({ refs: ["r12"] })   → 전체 원본 툴 결과
```

## 설정

`~/.pi/agent/recap/settings.json`:

```jsonc
{
  "enabled": false,
  "swapTurnThreshold": 5
}
```

| 키 | 기본값 | 설명 |
|---|---|---|
| `enabled` | `false` | 마스터 스위치 |
| `swapTurnThreshold` | `5` | 결과가 이 턴 수만큼 오래되면 스왑 |

참고:
- 세션 도중 활성화해도 이전 턴을 소급해서 recap하지 **않습니다** (지금부터 보이는 결과부터 recap이 생성됩니다).
- recap은 원본보다 **짧을 때만** 스왑됩니다 (그렇지 않으면 원본을 유지합니다).
- recap은 best-effort입니다: familiar 호출이 실패해도 원본은 컨텍스트에 그대로 남습니다.

## 아키텍처

```
index.ts              진입점 — 이벤트 + 명령/툴 등록
src/
  types.ts            config + 레코드 타입, 상수
  config.ts           ~/.pi/agent/recap/settings.json 로드/저장
  recap.ts            RecapIndex + familiar 호출 (공유 컨텍스트 요약)
  swap.ts             순수 컨텍스트 재작성 (오래된 → recap)
  recovery.ts         recap_recover 툴
  commands.ts         /Recap 명령
```

### 이벤트 흐름

```
session_start   loadConfig → 세션 엔트리에서 인덱스 복원 → 턴 카운터 리셋
turn_end        currentTurn = max(currentTurn, event.turnIndex)
context         Phase A: 새 toolResult마다 → fire-and-forget runRecap(...)
                Phase B: applyRecaps(...) → 오래된 결과를 recap으로 교체
```

### 영속성

- **Recap** — `sessionManager.appendCustomEntry("recap-entry", record)`, recap된 툴 결과마다 하나. LLM 컨텍스트에는 들어가지 **않습니다**.
- 세션 JSONL의 원본 `ToolResultMessage` 엔트리는 절대 수정되지 않습니다; 오직 *다음 요청의* 컨텍스트만 recap을 봅니다.

---

## 상태

초기/실험적입니다. familiar 호출은 결과마다 **메인 모델**을 쓰므로, 툴 호출이 많은 긴 세션에서는 매번 최신 모델 호출을 하나씩 추가합니다 — prefix-cache 재사용으로 많이 완화되긴 하지만, 실제 비용입니다. 조정 가능한 상한(recap할 최소 크기, 저렴한 모델 옵션)이 계획되어 있습니다.

**0.1.4**는 위 대규모 226-recap 실세션 측정을 추가하고 패키지 설명을 다듬었습니다.

**다음 (0.1.5):** (a) `edit`/`write` 결과를 recap에서 제외 — 226-recap 세션에서 이들의 recap은 전부 역압축이었음; (b) familiar 프롬프트를 개정해 0.1.3 보존 간극을 메움 — (경로, 이름, 값 등) 정확한 식별자와 우연한 디테일을, 작업의 직접 요청뿐 아니라 보존.

## 라이선스

MIT
