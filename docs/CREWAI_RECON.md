# 🔬 CrewAI 실측 정찰 보고서 (M0-T6)

**정찰일:** 2026-08-28
**대상:** `crewai==1.15.18`, `crewai-tools==1.15.18` (PyPI 최신 안정판, 실제 설치본)
**환경:** Python 3.12.14 / `backend/.venv`
**근거:** Spec §4.3 "구현 착수 전 필수 검증 절차" — 학습 데이터 추측 금지, 설치본 소스가 최종 진실

> 이 문서는 `backend/app/core/crewai_compat.py` 작성의 **유일한 근거**다.
> CrewAI 버전을 올릴 때는 이 문서를 재작성하고 compat 레이어와 픽스처 테스트만 재검증한다.

---

## 0. 검증 절차 수행 기록

| 단계 | 명령 | 결과 |
|---|---|---|
| 1 | `pip index versions crewai` | 최신 안정판 **1.15.18** (스펙 스냅샷과 일치) |
| 2 | `pip index versions crewai-tools` | 최신 안정판 **1.15.18** |
| 3 | `pip install crewai==1.15.18 crewai-tools==1.15.18` | 성공 |
| 4 | `model_fields` / `inspect.signature` 로 생성자 실측 | 아래 §1~§4 |
| 5 | `site-packages/crewai/llm.py` 소스 직독 | 아래 §2 |

---

## 🚨 1. 스펙 전제와 다른 점 (BREAKING FINDINGS)

> **이 절이 이 문서의 존재 이유다.** 스펙 v3.0이 가정한 API 중 실제와 다른 항목.

| # | 스펙 전제 | 실제 (1.15.18) | 대응 |
|---|---|---|---|
| **F1** | `litellm`이 CrewAI에 **내장**되어 LLM 게이트웨이 역할 (§4.3) | litellm은 **선택적 extra** (`crewai[litellm]`). 기본 설치에 **없음**. 네이티브 SDK 프로바이더가 1순위이고 litellm은 폴백 | `requirements.txt`에 `litellm`을 **명시적으로 추가**. 없으면 groq 실행 불가 |
| **F2** | `groq`를 `groq/` 접두사로 지원 (§5.3 매핑표) | `SUPPORTED_NATIVE_PROVIDERS`에 **groq 없음** → litellm 폴백 경로로만 동작 | litellm 필수 의존성화 (F1). groq 모델은 `groq/<model>` 문자열 유지 |
| **F3** | `Crew(full_output=True)` (§5.7) | `Crew`에 `full_output` 필드 **없음** | 노드 필드에서 제거. `CrewOutput.tasks_output`이 이미 전 태스크 출력을 담음 |
| **F4** | `LLM(max_retries=2)` (§5.3) | `LLM`에 `max_retries` 필드 **없음** | 노드 필드에서 제거. 재시도는 §11.4대로 애플리케이션 레이어에서 처리 |
| **F5** | 툴 `CodeInterpreterTool` (§5.6) | crewai-tools 1.15.18에 **존재하지 않음** (AWS Bedrock 내부 모듈만 있음) | 툴 레지스트리에서 제거. 코드 실행은 `Agent.allow_code_execution` + `code_execution_mode='safe'` 로 대체 |
| **F6** | `step_callback(AgentAction)` 페이로드로 노드 역매핑 (§10.5) | `AgentAction`/`AgentFinish`에 **에이전트 식별자가 전혀 없음** (`thought/tool/tool_input/text/result`) | **이벤트 버스(`crewai.events`)로 전환.** 모든 이벤트가 `agent_id`/`agent_role`/`task_id`/`task_name`을 실어 준다 |
| **F7** | 역매핑 1차 키 = `id(agent_object)` (§10.5) | 이벤트가 `agent_id` = **`Agent.id` (UUID) 문자열**을 제공 | UUID 문자열을 1차 키로 사용. `id()`보다 안정적 |
| **F8** | `crew.kickoff()`는 동기 블로킹이므로 `anyio.to_thread` 필요 (§10.4) | `Crew.kickoff_async()` **코루틴 존재** | `kickoff_async` 우선, 미지원/예외 시 `asyncio.to_thread(crew.kickoff)` 폴백 |
| **F9** | `Agent.max_iter` 기본값 20 (§5.4) | 실제 기본값 **25** | UI 기본값은 스펙대로 20 유지(보수적). 명시 전달 |
| **F10** | `Crew.cache` 기본값 true (§5.7) | 실제 기본값 **False** | 항상 명시적으로 전달 |
| **F11** | Ollama base_url을 `OLLAMA_HOST`로 (§13) | CrewAI가 읽는 `OLLAMA_HOST`는 **OpenAI 호환 엔드포인트**라 `/v1` 접미사 필요. 기본 `http://localhost:11434/v1` | 우리 `OLLAMA_HOST`(태그 조회용, `/v1` 없음)와 **의미가 다름**. LLM 생성 시 `base_url=f"{host}/v1"`를 **명시 전달**하고 env 의존 금지 |
| **F12** | `Task.context` 기본값 `None` | 기본값이 **`NOT_SPECIFIED` 센티널** (`crewai.utilities.constants`) | `context=None`을 넘기면 "명시적 컨텍스트 없음"으로 해석되어 자동 컨텍스트가 꺼진다. **연결이 없으면 아예 인자를 넘기지 않는다** |

---

## 2. LLM — `crewai.llm.LLM`

### 2.1. 라우팅 구조 (소스 직독: `crewai/llm.py:394 __new__`)

`LLM`은 **팩토리**다. `__new__`가 모델 문자열/`provider` 인자를 보고 네이티브 프로바이더 클래스 또는 litellm 폴백으로 라우팅한다.

```
우선순위
 1. custom_openai=True      → 네이티브 OpenAI 강제 (base_url 필수)
 2. provider= 명시          → 그 프로바이더 네이티브 강제
 3. model에 "/" 포함        → 접두사가 네이티브 목록에 있고 모델이 constants에 있으면 네이티브
                              아니면 litellm 폴백
 4. 그 외                   → 모델명으로 프로바이더 추론
```

**`SUPPORTED_NATIVE_PROVIDERS` (실측)**
```
openai, anthropic, claude, azure, azure_openai, google, gemini,
bedrock, aws, openrouter, deepseek, ollama, ollama_chat,
hosted_vllm, cerebras, dashscope, snowflake
```
→ **`groq` 없음.** (F2)

**네이티브 구현 디렉터리** `crewai/llms/providers/`
```
anthropic/  azure/  bedrock/  gemini/  openai/  openai_compatible/  snowflake/
```
`ollama`, `openrouter`, `deepseek`, `hosted_vllm`, `cerebras`, `dashscope` 는
전부 `openai_compatible/completion.py` 로 매핑된다 (OpenAI SDK + base_url).

**Ollama 기본 설정 (실측 `OPENAI_COMPATIBLE_PROVIDERS["ollama"]`)**
```python
base_url      = "http://localhost:11434/v1"   # ← /v1 접미사 주의 (F11)
api_key_env   = "OLLAMA_API_KEY"
base_url_env  = "OLLAMA_HOST"
api_key_required = False
default_api_key  = "ollama"
```

### 2.2. `LLM` 필드 (실측 `model_fields`)

| 필드 | 타입 | 기본값 | 우리 사용 |
|---|---|---|---|
| `model` | `str` | (필수) | ✅ `f"{prefix}{model}"` |
| `temperature` | `float \| None` | `None` | ✅ |
| `top_p` | `float \| None` | `None` | ✅ (Advanced) |
| `max_tokens` | `int \| float \| None` | `None` | ✅ |
| `api_key` | `str \| None` | `None` | ✅ BYOK 헤더값 주입 |
| `base_url` | `str \| None` | `None` | ✅ ollama/openai_compatible |
| `provider` | `str` | `'openai'` | ⚠️ 넘기면 네이티브 강제. **넘기지 않고 모델 접두사로 라우팅시킨다** |
| `timeout` | `float \| int \| None` | `None` | ✅ |
| `stop` / `additional_params` | `list` / `dict` | — | ❌ v1.0 미사용 |
| `stream` | `bool` | `False` | ❌ v1.0 미사용 |
| `api_base`, `api_version` | `str \| None` | `None` | ❌ (azure 전용) |
| `response_format`, `logit_bias`, `seed`, `n`, `frequency_penalty`, `presence_penalty`, `logprobs`, `reasoning_effort`, `thinking`, `interceptor` | — | — | ❌ v1.0 미사용 |

> ❌ **`max_retries` 없음** (F4)

### 2.3. 프로바이더 → 모델 접두사 확정표 (우리 컴파일러가 생성할 문자열)

| 우리 `provider` | 생성할 model 문자열 | 경로 | API Key env |
|---|---|---|---|
| `openai` | `openai/{model}` | 네이티브 | `OPENAI_API_KEY` |
| `anthropic` | `anthropic/{model}` | 네이티브 (`anthropic` extra 필요) | `ANTHROPIC_API_KEY` |
| `gemini` | `gemini/{model}` | 네이티브 (`google-genai` extra 필요) | `GEMINI_API_KEY` |
| `groq` | `groq/{model}` | **litellm 폴백** | `GROQ_API_KEY` |
| `ollama` | `ollama/{model}` + `base_url={host}/v1` | openai_compatible | 불필요 |
| `openai_compatible` | `openai/{model}` + `base_url=...` | 네이티브 OpenAI | 사용자 지정 |

---

## 3. Agent — `crewai.agent.core.Agent`

**필수:** `role`, `goal`, `backstory` (전부 `str`, 기본값 없음)

**우리가 사용하는 필드 (실측 확인 완료)**

| 필드 | 타입 | CrewAI 기본값 | 비고 |
|---|---|---|---|
| `role` / `goal` / `backstory` | `str` | (필수) | |
| `llm` | `str \| BaseLLM \| None` | `None` | LLM 인스턴스 그대로 전달 |
| `tools` | `list[BaseTool] \| None` | — | |
| `knowledge_sources` | `list[BaseKnowledgeSource] \| None` | `None` | Knowledge 노드용 |
| `allow_delegation` | `bool` | `False` | |
| `verbose` | `bool` | `False` | |
| `max_iter` | `int` | **25** (F9) | UI 기본 20을 명시 전달 |
| `max_rpm` | `int \| None` | `None` | |
| `cache` | `bool` | `True` | |
| `respect_context_window` | `bool` | `True` | |
| `max_execution_time` | `int \| None` | `None` | |
| `step_callback` | `Optional[Callable]` | `None` | Crew 레벨에서 일괄 지정 |
| `allow_code_execution` | `bool \| None` | `False` | F5 대체 수단 |
| `code_execution_mode` | `Literal['safe','unsafe']` | `'safe'` | |
| `function_calling_llm` | `str \| BaseLLM \| None` | `None` | v1.0 미사용 |
| `id` | `UUID` | 자동 | **역매핑 키** (F7) |

**주의:** `Agent.memory`, `Agent.knowledge`, `Agent.embedder`, `Agent.guardrail`, `Agent.reasoning`,
`Agent.planning`, `Agent.multimodal`, `Agent.skills`, `Agent.mcps`, `Agent.apps`, `Agent.a2a` 등이
새로 생겼으나 v1.0 스코프 밖이다. 넘기지 않는다.

---

## 4. Task — `crewai.task.Task`

| 필드 | 타입 | CrewAI 기본값 | 비고 |
|---|---|---|---|
| `description` | `str` | (필수) | `{var}` 보간은 CrewAI가 처리 |
| `expected_output` | `str` | (필수) | |
| `agent` | `BaseAgent \| None` | `None` | |
| `context` | `list[Task] \| None \| NOT_SPECIFIED` | **`NOT_SPECIFIED`** | ⚠️ F12 — 없으면 인자 생략 |
| `tools` | `list[BaseTool] \| None` | — | |
| `async_execution` | `bool \| None` | `False` | |
| `human_input` | `bool \| None` | `False` | |
| `output_file` | `str \| None` | `None` | |
| `create_directory` | `bool \| None` | `True` | |
| `markdown` | `bool \| None` | `False` | 스펙 UI 기본값 true → 명시 전달 |
| `name` | `str \| None` | `None` | 이벤트 `task_name`으로 나옴 → **캔버스 노드명을 넣는다** |
| `output_json` / `output_pydantic` / `response_model` | `type[BaseModel] \| None` | `None` | ⚠️ **문자열 JSON Schema가 아니라 Pydantic 클래스** |
| `guardrail` | `Callable \| None` | `None` | v1.1 Guardrail 노드용 |
| `max_retries` | `int \| None` | `None` | |
| `id` | `UUID` | 자동 | **역매핑 키** |

> ⚠️ 스펙 §5.5의 `output_format: raw/json/pydantic` + `json_schema` 문자열 조합은
> 실제 API와 맞지 않는다. v1.0에서는 **`raw`만 지원**하고, JSON 출력은
> `expected_output` 프롬프트로 유도한다. (동적 Pydantic 모델 생성은 v1.1 백로그)

### `TaskOutput` (task_callback / TaskCompletedEvent 페이로드)
```
description, name, expected_output, summary, raw, pydantic,
json_dict, agent (str — 역할 문자열), output_format, messages, tool_failures
```
→ `TaskOutput.agent`는 **문자열(role)** 이다. 노드 역매핑에 쓰지 말 것.

---

## 5. Crew — `crewai.crew.Crew`

| 필드 | 타입 | CrewAI 기본값 | 비고 |
|---|---|---|---|
| `agents` / `tasks` | `list` | (필수) | |
| `process` | `Process` | `Process.sequential` | enum 멤버: **`sequential`, `hierarchical`** (2개뿐) |
| `verbose` | `bool` | `False` | |
| `memory` | `Union` | `False` | bool 허용 |
| `cache` | `bool` | **`False`** (F10) | |
| `max_rpm` | `int \| None` | `None` | |
| `manager_llm` | `str \| BaseLLM \| None` | `None` | hierarchical 필수 |
| `manager_agent` | `BaseAgent \| None` | `None` | v1.0 미사용 |
| `planning` | `bool \| None` | `False` | |
| `planning_llm` | `str \| BaseLLM \| None` | `None` | |
| `step_callback` | `Optional[Callable]` | `None` | **취소 훅으로 사용** |
| `task_callback` | `Optional[Callable]` | `None` | |
| `knowledge_sources` | `list[...] \| None` | `None` | |
| `name` | `str \| None` | `'crew'` | |
| `embedder` | provider spec | `None` | memory 사용 시 필요 |
| `output_log_file` | `bool \| str \| None` | `None` | v1.0 미사용 |
| ❌ `full_output` | — | **없음** (F3) | |

**실행 API**
```python
Crew.kickoff(inputs=None, input_files=None, from_checkpoint=None) -> CrewOutput | CrewStreamingOutput
Crew.kickoff_async(...)  # 코루틴 (F8)
Crew.kickoff_for_each(inputs: list[dict], ...)
# ❌ Crew.stop / Crew.cancel 없음 → 취소는 step_callback 예외로 (Spec §10.6 유지)
```

**`CrewOutput`**: `raw`, `pydantic`, `json_dict`, `tasks_output: list[TaskOutput]`, `token_usage: UsageMetrics`

**`UsageMetrics`**:
`total_tokens, prompt_tokens, cached_prompt_tokens, completion_tokens, reasoning_tokens, cache_creation_tokens, successful_requests`

---

## 6. ⭐ 이벤트 버스 — 실시간 스트리밍의 진짜 통로

`crewai.events.event_bus.crewai_event_bus` (싱글턴)

```python
from crewai.events.event_bus import crewai_event_bus
from crewai.events.types.task_events import TaskStartedEvent

@crewai_event_bus.on(TaskStartedEvent)
def handler(source, event): ...
```

API: `on(event_type, depends_on=None)` (데코레이터) / `off(event_type, handler)` /
`emit(source, event)` / `scoped_handlers()` (컨텍스트 매니저) / `register_entity(entity)`

### 6.1. **모든 이벤트 공통 필드** (BaseEvent — 실측)
```
timestamp, type, event_id, parent_event_id, previous_event_id,
triggered_by_event_id, started_event_id, emission_sequence,
source_fingerprint, source_type, fingerprint_metadata,
task_id, task_name, agent_id, agent_role
```
> 🎯 **`agent_id` / `task_id`가 모든 이벤트에 실린다.** 이것이 노드 역매핑의 정답이다. (F6/F7)

### 6.2. 우리 SSE 이벤트(§10.2) ← CrewAI 이벤트 매핑 확정표

| 우리 SSE event | CrewAI 이벤트 클래스 | 사용 필드 |
|---|---|---|
| `run.started` | `CrewKickoffStartedEvent` | `crew_name`, `inputs` |
| `run.completed` | `CrewKickoffCompletedEvent` | `output`(CrewOutput), `total_tokens` |
| `run.failed` | `CrewKickoffFailedEvent` | `error` |
| `task.started` | `TaskStartedEvent` | `task_id`, `task_name`, `agent_id`, `context` |
| `task.completed` | `TaskCompletedEvent` | `output: TaskOutput`, `task_id` |
| `node.status` | 위 이벤트들에서 파생 | `task_id`/`agent_id` → node_id |
| `agent.thought` | `AgentExecutionStartedEvent` + `step_callback(AgentAction.thought)` | `task_prompt`, `thought` |
| `agent.tool_use` | `ToolUsageStartedEvent` | `tool_name`, `tool_args`, `tool_class`, `agent_id` |
| `agent.tool_result` | `ToolUsageFinishedEvent` | `output`, `started_at`, `finished_at`, `from_cache`, `failure` |
| `token.usage` | `LLMCallCompletedEvent` | `usage`, `model`, `call_id`, `agent_id` |
| `log` | `LLMCallFailedEvent`, `ToolUsageErrorEvent` 등 | |
| `edge.active` | 위 이벤트에서 파생 (백엔드 계산) | |

### 6.3. ⚠️ 싱글턴 동시성 주의 `MUST`

`crewai_event_bus`는 **프로세스 싱글턴**이다. `MAX_CONCURRENT_RUNS=3`이면
run 3개의 이벤트가 같은 핸들러로 들어온다.

**대응:** 앱 기동 시 핸들러를 **한 번만** 등록하고, 핸들러 안에서
`event.agent_id` / `event.task_id` / `source`(Crew 인스턴스) 를 키로
`RunRegistry`에서 해당 `run_id`의 `EventBridge`를 찾아 라우팅한다.
`scoped_handlers()`를 run마다 쓰면 다른 run의 핸들러가 날아간다. **쓰지 않는다.**

---

## 7. 툴 — `crewai_tools==1.15.18`

**존재 확인 완료 (v1.0 레지스트리 채택)**
`SerperDevTool`, `ScrapeWebsiteTool`, `FileReadTool`, `DirectoryReadTool`,
`WebsiteSearchTool`, `CSVSearchTool`, `YoutubeVideoSearchTool`

**존재하지 않음 → 제거** `CodeInterpreterTool` (F5)

**커스텀 툴 데코레이터** `crewai.tools.tool`
```python
tool(*args: Callable | str, result_schema: type[BaseModel] | None = None,
     result_as_answer: bool = False, max_usage_count: int | None = None)
```
`crewai.tools` 익스포트: `BaseTool`, `tool`, `EnvVar`, `ToolFailurePolicy`, `ToolFailureReason` …

> crewai-tools 1.15.18에는 툴 클래스가 **106종** 있다. 스펙 §5.6의 "하드코딩 금지,
> `GET /api/v1/tools`로 서빙" 원칙을 지키면 이후 확장이 프론트 수정 없이 가능하다.

### 7.1. ⚠️ F13 (2026-08-30 추가) — 툴 API 키는 생성자 인자가 아니다

`SerperDevTool` 소스 실측: `_make_api_request()` 가 `os.environ["SERPER_API_KEY"]`
를 **호출 시점에 직접** 읽는다. `model_fields` 에 `api_key` 필드 자체가 없다.
`env_vars: list[EnvVar]` 는 UI/문서용 선언일 뿐 실제 주입 경로가 아니다.

```python
headers = {"X-API-KEY": os.environ["SERPER_API_KEY"], ...}  # crewai_tools 소스 그대로
```

**영향:** `LLM(api_key=...)` 처럼 생성자로 BYOK 키를 넘길 수 없다. `tools/registry.py`
의 `build_tool()` 은 필요한 키를 확인한 뒤 `os.environ[key] = value` 로 주입한다.

**남은 리스크:** 이건 프로세스 전역 상태다. 동시 실행 2개가 서로 다른 사용자의
BYOK 키를 쓰면 나중에 실행된 쪽이 먼저 것을 덮어쓴다. `MAX_CONCURRENT_RUNS>1` 환경
에서 Run Manager(M2-T10)가 실행을 직렬화하거나(툴 사용 구간만) `os.environ` 스왑을
락으로 감싸기 전까지는 **알려진 제약**으로 남긴다. RAG 계열 툴(`WebsiteSearchTool`,
`CSVSearchTool`, `YoutubeVideoSearchTool`)의 임베딩 키도 동일 패턴(기본 `OPENAI_API_KEY`)
일 가능성이 높다 — 실제 임베딩 프로바이더를 붙일 때 재확인한다.

---

## 8. `requirements.txt` 확정 근거

```
crewai==1.15.18            # 실측 최신 안정판
crewai-tools==1.15.18      # 버전 동기
litellm>=1.84.0,<2         # F1/F2 — groq 등 비네이티브 프로바이더에 필수
anthropic~=0.73.0          # crewai[anthropic] extra — 네이티브 anthropic
google-genai~=1.65.0       # crewai[google-genai] extra — 네이티브 gemini
```
openai SDK / pydantic v2 / chromadb 등은 crewai가 직접 끌고 온다.

---

## 9. 다음 단계에 주는 지시

1. `backend/app/core/crewai_compat.py` 는 **이 문서의 §2~§7만** 근거로 작성한다.
2. 컴파일러(§8)는 `Task.context`를 조건부로 전달한다 (F12).
3. 실시간 스트리밍은 `step_callback`이 아니라 **이벤트 버스**를 1순위로 쓴다 (F6).
   `step_callback`은 (a) 취소 체크 (b) `AgentAction.thought` 수집 용도로만 쓴다.
4. 노드 역매핑 인덱스는 `str(agent.id) → node_id`, `str(task.id) → node_id` 두 개다.
5. 스펙의 `full_output` / `max_retries(LLM)` / `CodeInterpreterTool` / `output_format=json` 은
   **UI에서도 제거**한다. 존재하지 않는 기능을 그리면 사용자를 속이는 것이다.
