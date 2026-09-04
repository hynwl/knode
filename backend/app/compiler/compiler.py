"""Canvas Compiler — JSON 그래프 → CrewAI 객체 (Spec §8.1~§8.4).

6단계 파이프라인 중 [1] Normalize, [2]/[3] Structural·Semantic Validation,
[4] Topological Ordering 은 이미 구현된 `compiler/{graph,topology,validators}.py`
가 담당한다. 이 파일은 [5] Instantiation 과 [6] Binding 만 새로 구현한다.

⚠️ CrewAI 표면에는 `app.core.crewai_compat` 를 통해서만 닿는다. 여기서 직접
`from crewai import ...` 하지 않는다 (Spec §23-5).

**이 세션에서 의도적으로 비워둔 범위** (WORK_PLAN.md M2 세션 배치 계획 참조):

- **step_callback / task_callback** — 그대로 통과시키기만 한다. 콜백을 만드는
  EventBridge(M2-T8/T9)는 아직 없다.
- **Knowledge / Memory 노드** — `compiler/validators.py` 의 `REQUIRED_FIELDS` 에도
  없듯 아직 필드 검증조차 없는 범위 밖 기능이다. 연결되어 있어도 조용히 무시한다.

Tool 노드 인스턴스화는 M2-T6 `tools/registry.py` 의 `build_tool()` 이 기본
팩토리다 (`tool_factory=` 를 넘기면 테스트 등에서 덮어쓸 수 있다).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from app.compiler.graph import CanvasGraph
from app.compiler.interpolate import resolve_inputs
from app.compiler.topology import order_tasks
from app.compiler.validators import validate_graph
from app.core.crewai_compat import (
    Agent,
    BaseTool,
    Crew,
    LLM,
    PROVIDER_KEY_NAME,
    Task,
    agent_key,
    make_agent,
    make_crew,
    make_llm,
    make_task,
    normalize_ollama_base_url,
    task_key,
)
from app.config import get_settings
from app.core.errors import CompilationError
from app.core.security import guard_code_interpreter
from app.schemas.errors import Issue, has_errors, issue
from app.schemas.graph import AcNode, CanvasDoc
from app.tools.registry import build_tool as registry_build_tool


class SecretsLike(Protocol):
    """`SecretBundle`(M2-T13) 이 만족해야 할 최소 계약. 지금은 `dict` 로도 충분하다."""

    def get(self, key: str) -> str | None: ...


ToolFactory = Callable[[AcNode], BaseTool]

#: Spec §5.10 Human Input 노드 기본값 (frontend/src/nodes/registry.ts `human.defaults` 미러).
DEFAULT_HUMAN_PROMPT = "이 결과를 승인하시겠습니까?"
DEFAULT_HUMAN_TIMEOUT_S = 300
#: 노드 필드의 `min: 10` 과 동일. 위 상한은 무한 대기를 막기 위한 안전장치다
#: (Spec §5.10 ⚠️ "백엔드가 스레드 블로킹 상태로 대기하므로 타임아웃 필수").
MIN_HUMAN_TIMEOUT_S = 10
MAX_HUMAN_TIMEOUT_S = 3600


@dataclass(frozen=True)
class HumanGate:
    """Task 하나에 걸린 사람 검토 관문 (Spec §5.10)."""

    #: 검토 대상 Task 의 canvas node id.
    task_node_id: str
    #: 설정을 제공한 Human Input 노드 id. Task 자체 토글만 켠 경우 `None`.
    human_node_id: str | None
    prompt: str
    timeout_s: int
    on_timeout: str  # 'abort' | 'continue'


@dataclass
class CompileResult:
    crew: Crew
    node_index: dict[str, str]  # crewai 객체 id (agent_key/task_key) → canvas node id
    task_order: list[str]  # 실행 순서대로의 canvas task node id
    inputs: dict[str, Any] = field(default_factory=dict)
    warnings: list[Issue] = field(default_factory=list)
    #: task node id → 사람 검토 설정. 비어 있으면 이 run 에는 사람 검토가 없다.
    human_gates: dict[str, HumanGate] = field(default_factory=dict)


class CanvasCompiler:
    def __init__(
        self,
        doc: CanvasDoc,
        *,
        secrets: SecretsLike | None = None,
        inputs: dict[str, Any] | None = None,
        tool_factory: ToolFactory | None = None,
        step_callback: Callable[[Any], None] | None = None,
        task_callback: Callable[[Any], None] | None = None,
        dry_run: bool = False,
    ) -> None:
        self.doc = doc
        self.secrets = secrets
        self.provided_inputs = inputs or {}
        # `dry_run=True`면 `tools/registry.build_tool`의 키 누락(AC-E602) 검사를
        # 건너뛴다 — Dry Run은 키가 없어도 실행 순서/비용 미리보기가 가능해야 한다.
        self.tool_factory: ToolFactory = tool_factory or (
            lambda node: registry_build_tool(node, self.secrets, dry_run=dry_run)
        )
        self.step_callback = step_callback
        self.task_callback = task_callback
        self._cache: dict[str, Any] = {}
        self.node_index: dict[str, str] = {}
        self.human_gates: dict[str, HumanGate] = {}

    def compile(self) -> CompileResult:
        issues = validate_graph(self.doc)

        g = CanvasGraph.from_doc(self.doc).normalize()
        resolved_inputs, input_issues = resolve_inputs(g, self.provided_inputs)
        issues = issues + input_issues
        if has_errors(issues):
            raise CompilationError(issues)

        order = order_tasks(g)
        crew_node = g.single("crew")
        assert crew_node is not None  # AC-E101 이 이미 걸렀다

        tasks = [self._build_task(g, t) for t in order]
        agents = [self._build_agent(g, a) for a in g.incoming(crew_node.id, "agent")]
        crew = self._build_crew(g, crew_node, agents, tasks)

        return CompileResult(
            crew=crew,
            node_index=dict(self.node_index),
            task_order=[t.id for t in order],
            inputs=resolved_inputs,
            warnings=issues,
            human_gates=dict(self.human_gates),
        )

    # --- instantiation (전부 self._cache 경유, Spec §8.3 MUST) ---

    def _get_or_create(self, node_id: str, factory: Callable[[], Any]) -> Any:
        if node_id not in self._cache:
            self._cache[node_id] = factory()
        return self._cache[node_id]

    def _build_llm(self, node: AcNode) -> LLM:
        def factory() -> LLM:
            data = node.data
            provider = str(data.get("provider") or "openai")
            base_url = data.get("base_url") or None
            if provider == "ollama":
                # 노드에 base_url 을 안 박아뒀으면 `OLLAMA_HOST` 로 폴백한다
                # (Spec §19.3). 여기서 하드코딩된 localhost 를 쓰면 백엔드가
                # Docker 컨테이너 안에서 돌 때(§19.1) 항상 자기 자신에게 붙으려
                # 해서 실행이 깨진다 — 익스포트되는 standalone 스크립트
                # (export/python_renderer.py) 는 사용자 로컬 머신에서 직접
                # 돌아가므로 그쪽은 의도적으로 이 폴백을 쓰지 않는다.
                base_url = normalize_ollama_base_url(base_url or get_settings().ollama_host)
            # 노드가 키 슬롯(`key_ref`)을 지목했으면 **그 슬롯만** 본다.
            # 찾지 못해도 프로바이더 기본 키로 폴백하지 않는다 — 폴백하면
            # 사용자가 고르지 않은 계정의 키가 사용자가 지정한 `base_url`
            # 호스트로 나간다. 키가 없으면 실행 시점에 AC-E601/AC-E602 로
            # 드러나는 편이 안전하다.
            key_ref = str(data.get("key_ref") or "").strip()
            lookup = key_ref or PROVIDER_KEY_NAME.get(provider)
            api_key = self.secrets.get(lookup) if (self.secrets and lookup) else None
            return make_llm(
                provider=provider,
                model=str(data.get("model") or ""),
                temperature=data.get("temperature"),
                max_tokens=int(data["max_tokens"]) if data.get("max_tokens") is not None else None,
                top_p=data.get("top_p"),
                api_key=api_key,
                base_url=base_url,
                timeout_s=int(data["timeout_s"]) if data.get("timeout_s") is not None else None,
            )

        return self._get_or_create(node.id, factory)

    def _build_tool(self, node: AcNode) -> BaseTool:
        return self._get_or_create(node.id, lambda: self.tool_factory(node))

    def _build_agent(self, g: CanvasGraph, node: AcNode) -> Agent:
        def factory() -> Agent:
            data = node.data
            llm_nodes = g.incoming(node.id, "llm")
            tool_nodes = g.incoming(node.id, "tool")
            allow_code_execution = bool(data.get("allow_code_execution", False))
            guard_code_interpreter(allow_code_execution, node_id=node.id)
            agent = make_agent(
                role=str(data.get("role") or ""),
                goal=str(data.get("goal") or ""),
                backstory=str(data.get("backstory") or ""),
                llm=self._build_llm(llm_nodes[0]) if llm_nodes else None,
                tools=[self._build_tool(t) for t in tool_nodes],
                allow_delegation=bool(data.get("allow_delegation", False)),
                verbose=bool(data.get("verbose", True)),
                max_iter=int(data["max_iter"]) if data.get("max_iter") is not None else 20,
                max_rpm=int(data["max_rpm"]) if data.get("max_rpm") is not None else None,
                cache=bool(data.get("cache", True)),
                respect_context_window=bool(data.get("respect_context_window", True)),
                max_execution_time=(
                    int(data["max_execution_time"]) if data.get("max_execution_time") is not None else None
                ),
                allow_code_execution=allow_code_execution,
                step_callback=self.step_callback,
            )
            self.node_index[agent_key(agent)] = node.id
            return agent

        return self._get_or_create(node.id, factory)

    def _human_gate(self, g: CanvasGraph, node: AcNode) -> HumanGate | None:
        """Task 에 걸린 사람 검토 설정 (Spec §5.10).

        Human Input 노드를 Task 의 `next` 출력에 연결하면 그 노드의
        `prompt`/`timeout_s`/`on_timeout` 이 설정이 되고, Task 자체의
        `완료 후 사람 검토` 토글만 켠 경우는 **같은 동작의 빠른 기본값**이다
        (프롬프트/타임아웃은 기본값, 시간 초과 시 중단). 둘 다면 노드가 이긴다 —
        노드는 사용자가 명시적으로 값을 채운 쪽이기 때문이다.
        """
        human_nodes = [n for n in g.outgoing(node.id, "task") if n.type == "human"]
        toggled = bool(node.data.get("human_input", False))
        if not human_nodes and not toggled:
            return None

        source = human_nodes[0].data if human_nodes else {}
        raw_timeout = source.get("timeout_s")
        try:
            timeout_s = int(raw_timeout) if raw_timeout is not None else DEFAULT_HUMAN_TIMEOUT_S
        except (TypeError, ValueError):
            timeout_s = DEFAULT_HUMAN_TIMEOUT_S
        on_timeout = str(source.get("on_timeout") or "abort")
        return HumanGate(
            task_node_id=node.id,
            human_node_id=human_nodes[0].id if human_nodes else None,
            prompt=str(source.get("prompt") or DEFAULT_HUMAN_PROMPT),
            timeout_s=max(MIN_HUMAN_TIMEOUT_S, min(MAX_HUMAN_TIMEOUT_S, timeout_s)),
            on_timeout=on_timeout if on_timeout in ("abort", "continue") else "abort",
        )

    def _build_task(self, g: CanvasGraph, node: AcNode) -> Task:
        def factory() -> Task:
            data = node.data
            agent_nodes = g.incoming(node.id, "agent")
            context_nodes = g.incoming(node.id, "context")
            tool_nodes = g.incoming(node.id, "tool")
            gate = self._human_gate(g, node)
            if gate is not None:
                self.human_gates[node.id] = gate
            task = make_task(
                description=str(data.get("description") or ""),
                expected_output=str(data.get("expected_output") or ""),
                agent=self._build_agent(g, agent_nodes[0]),
                name=data.get("name"),
                context=[self._build_task(g, c) for c in context_nodes],
                tools=[self._build_tool(t) for t in tool_nodes],
                async_execution=bool(data.get("async_execution", False)),
                human_input=gate is not None,
                output_file=data.get("output_file") or None,
                markdown=bool(data.get("markdown", True)),
                max_retries=int(data["max_retries"]) if data.get("max_retries") is not None else None,
            )
            self.node_index[task_key(task)] = node.id
            return task

        return self._get_or_create(node.id, factory)

    def _build_crew(
        self, g: CanvasGraph, node: AcNode, agents: list[Agent], tasks: list[Task]
    ) -> Crew:
        data = node.data
        manager_llm = None
        if data.get("process") == "hierarchical":
            llm_nodes = g.incoming(node.id, "llm")
            manager_llm = self._build_llm(llm_nodes[0]) if llm_nodes else None
        return make_crew(
            agents=agents,
            tasks=tasks,
            process=str(data.get("process") or "sequential"),
            name=data.get("name"),
            verbose=bool(data.get("verbose", True)),
            memory=bool(data.get("memory", False)),
            cache=bool(data.get("cache", True)),
            max_rpm=int(data["max_rpm"]) if data.get("max_rpm") is not None else None,
            planning=bool(data.get("planning", False)),
            manager_llm=manager_llm,
            step_callback=self.step_callback,
            task_callback=self.task_callback,
        )


__all__ = [
    "SecretsLike", "ToolFactory", "CompileResult", "CanvasCompiler", "HumanGate",
    "DEFAULT_HUMAN_PROMPT", "DEFAULT_HUMAN_TIMEOUT_S",
    "MIN_HUMAN_TIMEOUT_S", "MAX_HUMAN_TIMEOUT_S",
]
