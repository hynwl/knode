/**
 * ⭐ 노드 정의 단일 진실 공급원 (Spec §5.1, §23-2)
 *
 * UI 렌더링 · 검증 · 컴파일 · 컨텍스트 메뉴 · 자동 연결 추천이 전부 이 파일을 참조한다.
 * 노드 정의를 다른 곳에서 중복 선언하지 않는다.
 *
 * ⚠️ CrewAI 실측 반영 (docs/CREWAI_RECON.md)
 *   - Crew.full_output 필드 제거          (F3)
 *   - LLM.max_retries 필드 제거           (F4)
 *   - CodeInterpreterTool 제거            (F5)
 *   - Task.output_format=json/pydantic 제거 → v1.0 은 raw 만 (RECON §4)
 *
 * 🌐 다국어 (Spec §17.3, M4-T4)
 *   사람이 읽는 문자열은 **전부 i18n 키**다 (`i18n/ko.json` · `i18n/en.json`).
 *   - `labelKey` / `descriptionKey` 는 이름부터 키임을 못 박아 두었다 — 예전
 *     `label`/`description` 을 그대로 두면 화면에 키가 새어 나가도 타입이
 *     조용히 통과한다.
 *   - `FieldSpec.label`/`placeholder`/`hint` 와 `FieldOption.label`/`hint` 는
 *     이름을 유지한다. 같은 타입을 `RunParametersModal` 이 **사용자가 입력한
 *     라벨**로도 채우기 때문 — 렌더러(`nodes/fields`)가 `t.k()` 로 "키처럼
 *     생겼으면 번역, 아니면 원문" 규칙을 적용한다 (`i18n/index.ts` 의 `tk`).
 *   - `keywords` 는 번역하지 않고 **두 언어를 함께** 담는다. 검색어이지 표시
 *     문자열이 아니라서, 로케일을 바꿨다고 한글 검색이 막히면 손해다.
 */

import type { FieldSpec } from './fieldSpec';
import type { PortSpec } from '@/ports/types';
import type { NodeAccentKey } from '@design/tokens';
import { t, tkValue } from '@/i18n';

export const NODE_TYPES = [
  'llm', 'agent', 'task', 'tool', 'crew', 'input', 'output',
  'knowledge', 'memory', 'human', 'router', 'guardrail', 'note', 'group',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_CATEGORIES = ['Agents', 'Tasks', 'Models', 'Tools', 'Data', 'Flow', 'Utils'] as const;
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

export type NodePriority = 'MUST' | 'SHOULD' | 'MAY';

export interface NodeDefinition {
  type: NodeType;
  /** i18n 키 (`node.<type>.label`). 표시할 땐 `nodeLabel()` 를 쓴다. */
  labelKey: string;
  category: NodeCategory;
  /** lucide-react 아이콘 이름 */
  icon: string;
  /** 헤더에 찍히는 2글자 모노 마크 (아티팩트 `.hmark`) */
  mark: string;
  /** design/tokens.ts nodeAccent 키 */
  accent: NodeAccentKey;
  /** i18n 키 (`node.<type>.desc`). 표시할 땐 `nodeDescription()` 를 쓴다. */
  descriptionKey: string;
  priority: NodePriority;
  /** false 면 백엔드 페이로드에서 제외한다 (Note/Group) */
  compilable: boolean;
  /** v1.0 에서 UI 만 두고 실행은 막을지 */
  disabledInV1?: boolean;
  inputs: PortSpec[];
  outputs: PortSpec[];
  fields: FieldSpec[];
  defaults: Record<string, unknown>;
  /** 검색 키워드 (컨텍스트 메뉴 퍼지 매칭용). 로케일 무관하게 전부 담는다. */
  keywords: string[];
}

/* ────────────────────────────── 공통 조각 ────────────────────────────── */

const nameField: FieldSpec = {
  key: 'name', label: 'field.common.nameLabel', kind: 'text',
  placeholder: 'field.common.namePlaceholder', showOnNode: true,
};

/* ────────────────────────────── 정의 ────────────────────────────── */

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  /* ───────────── 🧠 LLM (Spec §5.3) ───────────── */
  llm: {
    type: 'llm', labelKey: 'node.llm.label', category: 'Models', icon: 'Brain', mark: 'LM',
    accent: 'llm', priority: 'MUST', compilable: true,
    descriptionKey: 'node.llm.desc',
    keywords: ['llm', 'model', '모델', 'openai', 'gpt', 'claude', 'gemini', 'groq', 'ollama'],
    inputs: [],
    outputs: [{
      id: 'llm', type: 'llm', direction: 'out', label: 'llm',
      maxConnections: 'unbounded', descriptionKey: 'port.desc.llmOut',
    }],
    fields: [
      nameField,
      {
        key: 'provider', label: 'field.llm.providerLabel', kind: 'select', required: true, showOnNode: true,
        options: [
          { value: 'openai', label: 'opt.llm.providerOpenai' },
          { value: 'anthropic', label: 'opt.llm.providerAnthropic' },
          { value: 'gemini', label: 'opt.llm.providerGemini' },
          { value: 'groq', label: 'opt.llm.providerGroq', hint: 'opt.llm.providerGroqHint' },
          { value: 'ollama', label: 'opt.llm.providerOllama' },
          { value: 'openai_compatible', label: 'opt.llm.providerOpenaiCompatible' },
        ],
      },
      {
        key: 'model', label: 'field.llm.modelLabel', kind: 'combobox', required: true, showOnNode: true,
        placeholder: 'gpt-4o-mini',
        hint: 'field.llm.modelHint',
      },
      { key: 'temperature', label: 'field.llm.temperatureLabel', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { key: 'max_tokens', label: 'field.llm.maxTokensLabel', kind: 'number', advanced: true, min: 1, hint: 'field.llm.maxTokensHint' },
      { key: 'top_p', label: 'field.llm.topPLabel', kind: 'slider', advanced: true, min: 0, max: 1, step: 0.05 },
      {
        key: 'base_url', label: 'field.llm.baseUrlLabel', kind: 'text', advanced: true,
        placeholder: 'https://api.example.com/v1',
        hint: 'field.llm.baseUrlHint',
      },
      { key: 'timeout_s', label: 'field.llm.timeoutLabel', kind: 'number', advanced: true, min: 1 },
    ],
    defaults: {
      name: 'New LLM', provider: 'openai', model: 'gpt-4o-mini',
      temperature: 0.7, max_tokens: null, top_p: 1.0, base_url: null, timeout_s: 120,
    },
  },

  /* ───────────── 🤖 Agent (Spec §5.4) ───────────── */
  agent: {
    type: 'agent', labelKey: 'node.agent.label', category: 'Agents', icon: 'Bot', mark: 'AG',
    accent: 'agent', priority: 'MUST', compilable: true,
    descriptionKey: 'node.agent.desc',
    keywords: ['agent', '에이전트', 'role', 'worker', 'persona'],
    inputs: [
      { id: 'llm', type: 'llm', direction: 'in', label: 'llm', maxConnections: 1,
        descriptionKey: 'port.desc.agentLlm' },
      { id: 'tool', type: 'tool', direction: 'in', label: 'tools', maxConnections: 'unbounded' },
      { id: 'knowledge', type: 'knowledge', direction: 'in', label: 'knowledge', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'agent', type: 'agent', direction: 'out', label: 'agent', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'role', label: 'field.agent.roleLabel', kind: 'text', required: true, showOnNode: true,
        placeholder: 'field.agent.rolePlaceholder' },
      { key: 'goal', label: 'field.agent.goalLabel', kind: 'textarea', required: true, rows: 3, showOnNode: true,
        placeholder: 'field.agent.goalPlaceholder', interpolatesVars: true },
      { key: 'backstory', label: 'field.agent.backstoryLabel', kind: 'textarea', required: true, rows: 3,
        placeholder: 'field.agent.backstoryPlaceholder' },
      { key: 'allow_delegation', label: 'field.agent.allowDelegationLabel', kind: 'toggle' },
      { key: 'verbose', label: 'field.agent.verboseLabel', kind: 'toggle' },
      { key: 'max_iter', label: 'field.agent.maxIterLabel', kind: 'number', advanced: true, min: 1,
        hint: 'field.agent.maxIterHint' },
      { key: 'max_rpm', label: 'field.agent.maxRpmLabel', kind: 'number', advanced: true, min: 1 },
      { key: 'cache', label: 'field.agent.cacheLabel', kind: 'toggle', advanced: true },
      { key: 'respect_context_window', label: 'field.agent.respectContextWindowLabel', kind: 'toggle', advanced: true },
      { key: 'max_execution_time', label: 'field.agent.maxExecutionTimeLabel', kind: 'number', advanced: true, min: 1 },
      { key: 'allow_code_execution', label: 'field.agent.allowCodeExecutionLabel', kind: 'toggle', advanced: true,
        hint: 'field.agent.allowCodeExecutionHint' },
    ],
    defaults: {
      name: 'New Agent', role: '', goal: '', backstory: '',
      allow_delegation: false, verbose: true, max_iter: 20, max_rpm: null,
      cache: true, respect_context_window: true, max_execution_time: null,
      allow_code_execution: false,
    },
  },

  /* ───────────── 📋 Task (Spec §5.5) ───────────── */
  task: {
    type: 'task', labelKey: 'node.task.label', category: 'Tasks', icon: 'ClipboardList', mark: 'TK',
    accent: 'task', priority: 'MUST', compilable: true,
    descriptionKey: 'node.task.desc',
    keywords: ['task', '태스크', '작업', 'job', 'step'],
    inputs: [
      { id: 'agent', type: 'agent', direction: 'in', label: 'agent', maxConnections: 1, required: true },
      { id: 'context', type: 'context', direction: 'in', label: 'depends on', maxConnections: 'unbounded',
        descriptionKey: 'port.desc.taskContext' },
      { id: 'tool', type: 'tool', direction: 'in', label: 'tools', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'task', type: 'task', direction: 'out', label: 'next', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'description', label: 'field.task.descriptionLabel', kind: 'textarea', required: true, rows: 5, showOnNode: true,
        placeholder: 'field.task.descriptionPlaceholder', interpolatesVars: true },
      { key: 'expected_output', label: 'field.task.expectedOutputLabel', kind: 'textarea', required: true, rows: 3,
        placeholder: 'field.task.expectedOutputPlaceholder', interpolatesVars: true },
      { key: 'async_execution', label: 'field.task.asyncExecutionLabel', kind: 'toggle' },
      { key: 'human_input', label: 'field.task.humanInputLabel', kind: 'toggle' },
      { key: 'markdown', label: 'field.task.markdownLabel', kind: 'toggle' },
      { key: 'output_file', label: 'field.task.outputFileLabel', kind: 'text', advanced: true,
        hint: 'field.task.outputFileHint' },
      { key: 'max_retries', label: 'field.task.maxRetriesLabel', kind: 'number', advanced: true, min: 0 },
    ],
    defaults: {
      name: 'New Task', description: '', expected_output: '',
      async_execution: false, human_input: false, markdown: true,
      output_file: null, max_retries: null,
    },
  },

  /* ───────────── 🛠️ Tool (Spec §5.6) ───────────── */
  tool: {
    type: 'tool', labelKey: 'node.tool.label', category: 'Tools', icon: 'Wrench', mark: 'TL',
    accent: 'tool', priority: 'MUST', compilable: true,
    descriptionKey: 'node.tool.desc',
    keywords: ['tool', '툴', 'search', 'scrape', 'file', '검색'],
    inputs: [],
    outputs: [{ id: 'tool', type: 'tool', direction: 'out', label: 'tool', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'tool_id', label: 'field.tool.toolIdLabel', kind: 'select', required: true, showOnNode: true,
        hint: 'field.tool.toolIdHint',
      },
      { key: 'config', label: 'field.tool.configLabel', kind: 'code',
        hint: 'field.tool.configHint' },
    ],
    defaults: { name: 'New Tool', tool_id: 'serper_search', config: {} },
  },

  /* ───────────── 🏛️ Crew (Spec §5.7) ───────────── */
  crew: {
    type: 'crew', labelKey: 'node.crew.label', category: 'Flow', icon: 'Landmark', mark: 'CR',
    accent: 'crew', priority: 'MUST', compilable: true,
    descriptionKey: 'node.crew.desc',
    keywords: ['crew', '크루', 'orchestrator', 'process', 'root'],
    inputs: [
      { id: 'agent', type: 'agent', direction: 'in', label: 'agents', maxConnections: 'unbounded' },
      { id: 'task', type: 'task', direction: 'in', label: 'tasks', maxConnections: 'unbounded' },
      { id: 'llm', type: 'llm', direction: 'in', label: 'manager llm', maxConnections: 1,
        descriptionKey: 'port.desc.crewManagerLlm' },
      { id: 'memory', type: 'memory', direction: 'in', label: 'memory', maxConnections: 1 },
      { id: 'knowledge', type: 'knowledge', direction: 'in', label: 'knowledge', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'result', type: 'result', direction: 'out', label: 'result', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'process', label: 'field.crew.processLabel', kind: 'select', required: true, showOnNode: true,
        options: [
          { value: 'sequential', label: 'opt.crew.processSequential' },
          { value: 'hierarchical', label: 'opt.crew.processHierarchical', hint: 'opt.crew.processHierarchicalHint' },
        ],
      },
      { key: 'verbose', label: 'field.crew.verboseLabel', kind: 'toggle' },
      { key: 'memory', label: 'field.crew.memoryLabel', kind: 'toggle',
        hint: 'field.crew.memoryHint' },
      { key: 'cache', label: 'field.crew.cacheLabel', kind: 'toggle' },
      { key: 'planning', label: 'field.crew.planningLabel', kind: 'toggle', advanced: true },
      { key: 'max_rpm', label: 'field.crew.maxRpmLabel', kind: 'number', advanced: true, min: 1 },
    ],
    // RECON F3: full_output 은 CrewAI 1.15.18 에 존재하지 않으므로 필드 없음
    defaults: {
      name: 'My Crew', process: 'sequential', verbose: true,
      memory: false, cache: true, planning: false, max_rpm: null,
    },
  },

  /* ───────────── 📥 Input (Spec §5.8) ───────────── */
  input: {
    type: 'input', labelKey: 'node.input.label', category: 'Data', icon: 'LogIn', mark: 'IN',
    accent: 'input', priority: 'MUST', compilable: true,
    descriptionKey: 'node.input.desc',
    keywords: ['input', '입력', 'variable', '변수', 'prompt', 'param'],
    inputs: [],
    outputs: [{ id: 'text', type: 'text', direction: 'out', label: 'text', maxConnections: 'unbounded' }],
    fields: [
      { key: 'var_name', label: 'field.input.varNameLabel', kind: 'text', required: true, showOnNode: true,
        placeholder: 'topic', hint: 'field.input.varNameHint' },
      { key: 'label', label: 'field.input.labelLabel', kind: 'text', required: true, showOnNode: true,
        placeholder: 'field.input.labelPlaceholder' },
      {
        key: 'input_type', label: 'field.input.inputTypeLabel', kind: 'select',
        options: [
          { value: 'text', label: 'opt.input.typeText' },
          { value: 'textarea', label: 'opt.input.typeTextarea' },
          { value: 'number', label: 'opt.input.typeNumber' },
          { value: 'select', label: 'opt.input.typeSelect' },
        ],
      },
      { key: 'default_value', label: 'field.input.defaultValueLabel', kind: 'text' },
      { key: 'options', label: 'field.input.optionsLabel', kind: 'tags', visibleWhen: { key: 'input_type', equals: 'select' } },
      { key: 'required', label: 'field.input.requiredLabel', kind: 'toggle' },
      { key: 'description', label: 'field.input.descriptionLabel', kind: 'text', advanced: true },
    ],
    defaults: {
      var_name: 'topic', label: 'default.inputLabel', input_type: 'text',
      default_value: '', options: [], required: true, description: '',
    },
  },

  /* ───────────── 📤 Output (Spec §5.9) ───────────── */
  output: {
    type: 'output', labelKey: 'node.output.label', category: 'Data', icon: 'LogOut', mark: 'OU',
    accent: 'output', priority: 'MUST', compilable: true,
    descriptionKey: 'node.output.desc',
    keywords: ['output', '출력', 'result', '결과', 'report'],
    inputs: [
      { id: 'result', type: 'result', direction: 'in', label: 'result', maxConnections: 1 },
      { id: 'task', type: 'task', direction: 'in', label: 'tasks', maxConnections: 'unbounded' },
    ],
    outputs: [],
    fields: [
      { key: 'title', label: 'field.output.titleLabel', kind: 'text', showOnNode: true },
      {
        key: 'render_as', label: 'field.output.renderAsLabel', kind: 'select',
        options: [
          { value: 'markdown', label: 'opt.output.renderMarkdown' },
          { value: 'plain', label: 'opt.output.renderPlain' },
          { value: 'json', label: 'opt.output.renderJson' },
        ],
      },
      { key: 'allow_download', label: 'field.output.allowDownloadLabel', kind: 'toggle' },
    ],
    defaults: { title: 'default.outputTitle', render_as: 'markdown', allow_download: true },
  },

  /* ───────────── 📚 Knowledge (Spec §5.10) ───────────── */
  knowledge: {
    type: 'knowledge', labelKey: 'node.knowledge.label', category: 'Data', icon: 'BookOpen', mark: 'KN',
    accent: 'knowledge', priority: 'SHOULD', compilable: true,
    descriptionKey: 'node.knowledge.desc',
    keywords: ['knowledge', '지식', 'rag', 'document', '문서', 'pdf'],
    inputs: [],
    outputs: [{ id: 'knowledge', type: 'knowledge', direction: 'out', label: 'knowledge', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'source_type', label: 'field.knowledge.sourceTypeLabel', kind: 'select', showOnNode: true,
        options: [
          { value: 'text', label: 'opt.knowledge.sourceText' },
          { value: 'file', label: 'opt.knowledge.sourceFile' },
          { value: 'url', label: 'opt.knowledge.sourceUrl' },
        ],
      },
      { key: 'content', label: 'field.knowledge.contentLabel', kind: 'textarea', rows: 5,
        visibleWhen: { key: 'source_type', equals: 'text' } },
      { key: 'file_ref', label: 'field.knowledge.fileRefLabel', kind: 'file',
        visibleWhen: { key: 'source_type', equals: 'file' },
        hint: 'field.knowledge.fileRefHint' },
      { key: 'url', label: 'field.knowledge.urlLabel', kind: 'text', visibleWhen: { key: 'source_type', equals: 'url' } },
      { key: 'chunk_size', label: 'field.knowledge.chunkSizeLabel', kind: 'number', advanced: true, min: 200 },
      { key: 'chunk_overlap', label: 'field.knowledge.chunkOverlapLabel', kind: 'number', advanced: true, min: 0 },
    ],
    defaults: {
      name: 'Knowledge', source_type: 'text', content: '', file_ref: null, url: '',
      chunk_size: 4000, chunk_overlap: 200,
    },
  },

  /* ───────────── 🧩 Memory (Spec §5.10) ───────────── */
  memory: {
    type: 'memory', labelKey: 'node.memory.label', category: 'Data', icon: 'Puzzle', mark: 'ME',
    accent: 'memory', priority: 'SHOULD', compilable: true,
    descriptionKey: 'node.memory.desc',
    keywords: ['memory', '메모리', 'short term', 'long term'],
    inputs: [],
    outputs: [{ id: 'memory', type: 'memory', direction: 'out', label: 'memory', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'short_term', label: 'field.memory.shortTermLabel', kind: 'toggle', showOnNode: true },
      { key: 'long_term', label: 'field.memory.longTermLabel', kind: 'toggle' },
      { key: 'entity', label: 'field.memory.entityLabel', kind: 'toggle' },
      { key: 'storage_path', label: 'field.memory.storagePathLabel', kind: 'text', advanced: true },
    ],
    defaults: { name: 'Memory', short_term: true, long_term: false, entity: false, storage_path: null },
  },

  /* ───────────── 🙋 Human Input (Spec §5.10) ───────────── */
  human: {
    type: 'human', labelKey: 'node.human.label', category: 'Flow', icon: 'UserRoundCheck', mark: 'HU',
    accent: 'human', priority: 'SHOULD', compilable: true,
    descriptionKey: 'node.human.desc',
    keywords: ['human', '사람', 'approval', '승인', 'hitl', 'review'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'after task', maxConnections: 'unbounded' }],
    outputs: [],
    fields: [
      nameField,
      { key: 'prompt', label: 'field.human.promptLabel', kind: 'textarea', rows: 3, showOnNode: true },
      { key: 'timeout_s', label: 'field.human.timeoutLabel', kind: 'number', min: 10 },
      {
        key: 'on_timeout', label: 'field.human.onTimeoutLabel', kind: 'select',
        options: [
          { value: 'abort', label: 'opt.human.timeoutAbort' },
          { value: 'continue', label: 'opt.human.timeoutContinue' },
        ],
      },
    ],
    defaults: { name: 'Human Review', prompt: 'default.humanPrompt', timeout_s: 300, on_timeout: 'abort' },
  },

  /* ───────────── 🔀 Router (v1.1) ───────────── */
  router: {
    type: 'router', labelKey: 'node.router.label', category: 'Flow', icon: 'GitBranch', mark: 'RT',
    accent: 'router', priority: 'MAY', compilable: true, disabledInV1: true,
    descriptionKey: 'node.router.desc',
    keywords: ['router', '분기', 'condition', 'if', 'branch'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'from', maxConnections: 'unbounded' }],
    outputs: [
      { id: 'true', type: 'task', direction: 'out', label: 'match', maxConnections: 'unbounded' },
      { id: 'false', type: 'task', direction: 'out', label: 'else', maxConnections: 'unbounded' },
    ],
    fields: [
      nameField,
      {
        key: 'mode', label: 'field.router.modeLabel', kind: 'select',
        options: [
          { value: 'keyword', label: 'opt.router.modeKeyword' },
          { value: 'regex', label: 'opt.router.modeRegex' },
          { value: 'llm_judge', label: 'opt.router.modeLlmJudge' },
        ],
      },
      { key: 'condition', label: 'field.router.conditionLabel', kind: 'text', showOnNode: true },
    ],
    defaults: { name: 'Router', mode: 'keyword', condition: '' },
  },

  /* ───────────── 🛡️ Guardrail (v1.1) ───────────── */
  guardrail: {
    type: 'guardrail', labelKey: 'node.guardrail.label', category: 'Flow', icon: 'ShieldCheck', mark: 'GR',
    accent: 'router', priority: 'MAY', compilable: true, disabledInV1: true,
    descriptionKey: 'node.guardrail.desc',
    keywords: ['guardrail', '검증', 'validate', 'schema'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'validates', maxConnections: 'unbounded' }],
    outputs: [],
    fields: [
      nameField,
      {
        key: 'type', label: 'field.guardrail.typeLabel', kind: 'select',
        options: [
          { value: 'length', label: 'opt.guardrail.typeLength' },
          { value: 'json_schema', label: 'opt.guardrail.typeJsonSchema' },
          { value: 'llm_check', label: 'opt.guardrail.typeLlmCheck' },
        ],
      },
      { key: 'retry_count', label: 'field.guardrail.retryCountLabel', kind: 'number', min: 0 },
    ],
    defaults: { name: 'Guardrail', type: 'length', retry_count: 2 },
  },

  /* ───────────── 📝 Note (Spec §5.10) ───────────── */
  note: {
    type: 'note', labelKey: 'node.note.label', category: 'Utils', icon: 'StickyNote', mark: 'NT',
    accent: 'note', priority: 'SHOULD', compilable: false,
    descriptionKey: 'node.note.desc',
    keywords: ['note', '메모', 'comment', '주석', 'markdown'],
    inputs: [], outputs: [],
    fields: [{ key: 'text', label: 'field.note.textLabel', kind: 'textarea', rows: 6, showOnNode: true }],
    defaults: { text: 'default.noteText' },
  },

  /* ───────────── 🗂️ Group (Spec §5.10) ───────────── */
  group: {
    type: 'group', labelKey: 'node.group.label', category: 'Utils', icon: 'Group', mark: 'GP',
    accent: 'group', priority: 'SHOULD', compilable: false,
    descriptionKey: 'node.group.desc',
    keywords: ['group', '그룹', 'frame', '프레임'],
    inputs: [], outputs: [],
    fields: [
      { key: 'title', label: 'field.group.titleLabel', kind: 'text', showOnNode: true },
      { key: 'color', label: 'field.group.colorLabel', kind: 'select', options: [
        { value: 'note', label: 'opt.group.colorNote' },
        { value: 'agent', label: 'opt.group.colorAgent' },
        { value: 'task', label: 'opt.group.colorTask' },
        { value: 'tool', label: 'opt.group.colorTool' },
        { value: 'llm', label: 'opt.group.colorLlm' },
      ] },
    ],
    defaults: { title: 'default.groupTitle', color: 'note' },
  },
};

/* ────────────────────────────── 조회 헬퍼 ────────────────────────────── */

export function getNodeDef(type: NodeType): NodeDefinition {
  const def = NODE_DEFINITIONS[type];
  if (!def) throw new Error(t('registry.unknownNodeType', { type }));
  return def;
}

/** 현재 로케일의 노드 이름. 렌더 시점마다 호출해야 로케일 전환이 반영된다. */
export function nodeLabel(def: NodeDefinition): string {
  return t(def.labelKey);
}

/** 현재 로케일의 노드 설명. */
export function nodeDescription(def: NodeDefinition): string {
  return t(def.descriptionKey);
}

export function getPort(type: NodeType, portId: string) {
  const def = getNodeDef(type);
  return [...def.inputs, ...def.outputs].find((p) => p.id === portId);
}

/**
 * 새 노드의 초기 데이터.
 *
 * 기본값 중 `default.*` 키로 적힌 것들(Output 제목, Note 본문 …)은 여기서 **현재
 * 로케일로 한 번 굳힌다.** 이 값은 곧바로 사용자 문서(`CanvasDoc`)에 저장되어
 * 사용자가 직접 고칠 수 있는 데이터가 되므로, 나중에 로케일을 바꿨다고 사용자가
 * 쓴 글이 되돌아가면 안 된다. 키처럼 생기지 않은 값('New LLM', 'gpt-4o-mini' …)은
 * 그대로 통과한다.
 */
export function defaultDataFor(type: NodeType): Record<string, unknown> {
  const cloned = structuredClone(getNodeDef(type).defaults);
  for (const [k, v] of Object.entries(cloned)) cloned[k] = tkValue(v);
  return cloned;
}

/** 컨텍스트 메뉴/노드 라이브러리용 카테고리 그룹 */
export function nodesByCategory(): Record<NodeCategory, NodeDefinition[]> {
  const out = Object.fromEntries(NODE_CATEGORIES.map((c) => [c, [] as NodeDefinition[]])) as Record<
    NodeCategory, NodeDefinition[]
  >;
  for (const def of Object.values(NODE_DEFINITIONS)) out[def.category].push(def);
  return out;
}

/** 퍼지 검색 (컨텍스트 메뉴 Spec §3.4.1) */
export function searchNodes(query: string): NodeDefinition[] {
  const q = query.trim().toLowerCase();
  const all = Object.values(NODE_DEFINITIONS);
  if (!q) return all;
  const score = (d: NodeDefinition): number => {
    // 표시 이름은 현재 로케일 기준으로, 키워드는 로케일 무관하게 매칭한다.
    const hay = [nodeLabel(d), d.type, ...d.keywords].map((s) => s.toLowerCase());
    if (hay.some((h) => h === q)) return 0;
    if (hay.some((h) => h.startsWith(q))) return 1;
    if (hay.some((h) => h.includes(q))) return 2;
    // 퍼지: 문자 순서 유지 부분일치
    if (hay.some((h) => fuzzyIncludes(h, q))) return 3;
    return Number.POSITIVE_INFINITY;
  };
  return all
    .map((d) => [d, score(d)] as const)
    .filter(([, s]) => Number.isFinite(s))
    .sort((a, b) => a[1] - b[1])
    .map(([d]) => d);
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}
