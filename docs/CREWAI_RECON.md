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
| **F15** | ① 이벤트 버스의 `source`는 `Crew` 인스턴스 ② `Agent.step_callback`이 매 스텝 호출되므로 취소 검문소로 쓸 수 있음 (§10.5/§10.6) | ① `source`는 **이벤트를 발행한 객체 자신**이다(Task/Agent/LLM/ToolUsage). `Crew`가 source인 건 `crew_*` 이벤트뿐 ② 기본 `executor_class`가 `experimental.agent_executor.AgentExecutor`인데 **툴 없는 에이전트 경로에서는 `step_callback`을 한 번도 부르지 않는다**(실측: 3태스크 실행에 0회) | ① run 라우팅을 `collect_run_objects()`(크루+에이전트+태스크+LLM+툴) 전량 등록 + 이벤트의 `task_id`/`agent_id` 2차 인덱스로 바꿈 ② 취소 주 검문소를 **`Crew.task_callback`(태스크 경계, 호출 보장)** 으로 이동. 자세한 근거는 §6.4 |
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
`source` 객체 identity(→ `event.agent_id` / `event.task_id` 폴백)를 키로
`RunRegistry`에서 해당 `run_id`의 `EventBridge`를 찾아 라우팅한다.
⚠️ `source`는 **Crew가 아니다** — §6.4(F15) 필독. 이 문서 초판은 Crew라고
적어 놨고, 그 전제로 짠 코드가 실제로 이벤트를 전부 흘렸다.
`scoped_handlers()`를 run마다 쓰면 다른 run의 핸들러가 날아간다. **쓰지 않는다.**

### 6.4. ⭐ F15 (2026-08-31 추가, M2 DoD 실전 검증 중 발견) — `source`는 Crew가 아니고, `step_callback`은 호출 보장이 없다

**증상:** 실제 Ollama 실행이 끝까지 성공하는데도 SSE로 나가는 이벤트가
`run.started` / `run.completed` **둘뿐**이었다(`node.status`·`task.*`·`token.usage` 0건).
Stop 을 세 번 눌러도(`POST /cancel` 202 × 3) 크루가 끝까지 실행됐다.

**원인 1 — 라우팅.** §6.3 이 "`source`(Crew 인스턴스)를 키로 라우팅"이라고
적어 놨지만, 실제 `crewai_event_bus.emit(source, event)` 의 `source` 는
**이벤트를 발행한 객체 자신**이다 (소스 실측):

| 이벤트 | 발행 지점 | source |
|---|---|---|
| `TaskStartedEvent`/`TaskCompletedEvent` | `crewai/task.py` `emit(self, ...)` | **Task** |
| `AgentExecutionStartedEvent` 등 | `crewai/agent/core.py` `emit(self, ...)` | **Agent** |
| `LLMCall*Event` | `crewai/llms/base_llm.py` `emit(self, ...)` | **LLM** |
| `ToolUsage*Event` | `crewai/tools/tool_usage.py` `emit(self, ...)` | **ToolUsage**(컴파일 산출물 아님) |
| `CrewKickoff*Event` | `crewai/crew.py` | Crew |

→ `id(crew)` 하나만 등록하면 `crew_*` 말고는 **전부 버려진다.**
대응: `crewai_compat.collect_run_objects(crew)` 로 크루·에이전트·태스크·LLM·툴을
전량 등록하고, 그래도 못 잡는 source(ToolUsage)는 이벤트의 `task_id`/`agent_id` 로
2차 라우팅한다.

**원인 2 — 식별자 누락.** `AgentExecutionStartedEvent` 는 `from_agent`/`from_task`
를 넘기지 않아 `BaseEvent._set_agent_params` 가 돌지 않는다 → `agent_id`/`task_id`
가 **둘 다 None**. `TaskStartedEvent` 도 `task_id` 만 채우고 `agent_id` 는 비운다.
→ 노드 역매핑에 **source 객체의 `.id`** 폴백(`instance_key()`)이 필요하고,
`task.started` 의 `agent_node_id` 는 직전 `agent_started` 로 귀속시킨다.

**원인 3 — 취소.** `Agent.step_callback` 은 호출이 **보장되지 않는다**.
1.15.18 의 `Agent.executor_class` 기본값은 `CrewAgentExecutor` 가 아니라
`crewai.experimental.agent_executor.AgentExecutor` 이고, 툴 없는 에이전트가 타는
경로에서는 `_invoke_step_callback` 을 호출하지 않는다 (실측 스크립트: 3태스크 실행
step_callback **0회**, task_callback **3회**).

또한 step_callback 에서 raise 하면 `Agent.execute_task` 의 `except Exception →
_handle_execution_error` 재시도 루프(`max_retry_limit` 기본 **2**) 안이라, 취소가
**같은 태스크를 두 번 더 실행시킨 뒤에야** 밖으로 나온다.

→ **취소의 주 검문소는 `Crew.task_callback`.** `Task._execute_core` 가 산출물을
확정한 직후·다음 태스크 전에 크루 스레드에서 호출되고, 여기서 raise 하면
`Task._execute_core`(`TaskFailedEvent` 발행 후 `raise e`) → `Crew._execute_tasks`
→ `kickoff()` 로 **재시도 없이** 그대로 전파된다. 실측: 4태스크 실행 중 취소 요청
→ 진행 중이던 태스크가 끝난 직후(≈6초) `run.cancelled`.
`step_callback` 검문소는 보조로 남긴다(툴 쓰는 에이전트에선 태스크 중간에도 걸린다).

**남는 한계(정직하게 알릴 것):** CrewAI 1.15.18 에는 진행 중인 LLM 호출을 끊는
공개 API가 없다(`Crew.stop`/`cancel` 부재는 테스트로 고정). 그래서 취소는
**태스크 경계 단위**다 — UI는 "즉시 중단"이라고 말하면 안 되고
"진행 중인 태스크가 끝나는 즉시 중단됩니다"라고 알린다.

**회귀 가드:** `tests/test_crewai_compat.py` 의
`test_event_bus_source_is_the_emitting_object_not_the_crew` /
`test_task_started_event_carries_no_agent_id_field_value`,
`tests/test_runtime.py` 의 라우팅 테스트군, `tests/test_runtime_manager.py` 의
`test_cancel_stops_run_at_task_boundary_even_if_step_callback_never_fires`.

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

### 7.2. ⭐ F14 (2026-08-31 추가, M2-T19) — SSRF/경로 가드가 이미 라이브러리에 내장되어 있다

M0-T6 정찰 시점(2026-08-28)에는 없었거나 확인하지 못했던 보안 프리미티브가
`crewai_tools==1.15.18` 설치본에 이미 들어 있다. **스펙 §12.5 는 "우리가 처음부터
만들어야 한다"는 전제였지만, 실측 결과 대부분은 이미 있고 우리가 할 일은
"제대로 배선하기"에 가깝다.**

| 모듈 | 제공 내용 |
|---|---|
| `crewai_tools.security.safe_path` | `validate_url()`(사설/예약 IP·`file://` 차단), `validate_file_path()`/`validate_directory_path()`(`base_dir` 컨테인먼트, symlink·`..` 정규화 후 검사) |
| `crewai_tools.security.ssrf_adapter` | `SSRFProtectedAdapter` — `requests` 커넥션을 **소켓 레벨에서 피어 IP 고정** 검증. DNS 리바인딩·리다이렉트 우회까지 막는다 (매 홉마다 재검증) |

**실측 세부사항 (직접 소스 대조):**
- `ScrapeWebsiteTool._run()` → 내부 `safe_get()` 이 이미 `validate_url()` +
  `SSRFProtectedAdapter` 체인으로 나간다. **추가 조치 불필요**, 다만 설정에 개발자가
  박아 넣은 `website_url` 은 컴파일 타임에 먼저 걸러 UX 를 개선한다(AC-E801).
- `FileReadTool.__init__(file_path, base_dir)` → 런타임에 에이전트가 고르는 경로는
  `base_dir` 로 가둔다. **단, 생성자로 받은 `file_path` 자체는 컨테인먼트를
  우회한다**("개발자 의도"로 신뢰) — 그래서 노드 설정값은 별도로 컴파일 타임에
  검사해야 유일한 방어선이 된다.
- `DirectoryReadTool` 은 **`base_dir` 파라미터 자체가 없다** (`validate_directory_path()`
  호출 시 항상 `os.getcwd()` 기본값) → 그대로 쓰면 `WORKSPACE_DIR` 이 아니라
  백엔드 프로세스의 cwd 로 가둬진다. `WorkspaceDirectoryReadTool` 서브클래스로
  `_run()` 의 `validate_directory_path()` 호출에 `base_dir` 를 끼워 넣어야 한다.
- 이스케이프 해치 `CREWAI_TOOLS_ALLOW_UNSAFE_PATHS=true` 가 이 가드들을 전부 끈다.
  라이브러리 자체 문서(`safe_path.py` 모듈 docstring)가 멀티테넌트 배포는
  `CREWAI_TOOLS_FORCE_SAFE_PATHS=true` 로 이 해치를 잠그라고 권고한다 — AgentCanvas
  는 BYOK 멀티테넌트가 정확히 그 시나리오라 `core/security.py` 임포트 시점에
  강제한다.

**영향:** `core/security.py` (M2-T19)가 이 서브패키지에 닿는 유일한 통로다.
`custom_http` 은 `SSRFProtectedAdapter` 를 직접 마운트한 `requests.Session` 으로
구현해 활성화했다(이전까지 F5/SSRF 미비로 비활성).

**CrewAI 버전을 올릴 때:** `crewai_tools.security.safe_path` /
`crewai_tools.security.ssrf_adapter` 모듈이 여전히 존재하고 동일한 함수 시그니처를
갖는지 `backend/tests/test_security.py` 로 먼저 재검증한다. 사라졌다면(구버전으로
다운그레이드하거나 이 보안 서브패키지가 리팩터링된 경우) `core/security.py` 는
자체 SSRF/경로 가드로 되돌아가야 한다.

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
