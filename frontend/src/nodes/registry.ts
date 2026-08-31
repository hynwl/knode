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
 */

import type { FieldSpec } from './fieldSpec';
import type { PortSpec } from '@/ports/types';
import type { NodeAccentKey } from '@design/tokens';

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
  label: string;
  category: NodeCategory;
  /** lucide-react 아이콘 이름 */
  icon: string;
  /** 헤더에 찍히는 2글자 모노 마크 (아티팩트 `.hmark`) */
  mark: string;
  /** design/tokens.ts nodeAccent 키 */
  accent: NodeAccentKey;
  description: string;
  priority: NodePriority;
  /** false 면 백엔드 페이로드에서 제외한다 (Note/Group) */
  compilable: boolean;
  /** v1.0 에서 UI 만 두고 실행은 막을지 */
  disabledInV1?: boolean;
  inputs: PortSpec[];
  outputs: PortSpec[];
  fields: FieldSpec[];
  defaults: Record<string, unknown>;
  /** 검색 키워드 (컨텍스트 메뉴 퍼지 매칭용) */
  keywords: string[];
}

/* ────────────────────────────── 공통 조각 ────────────────────────────── */

const nameField: FieldSpec = {
  key: 'name', label: '이름', kind: 'text',
  placeholder: '캔버스 표시용 이름', showOnNode: true,
};

/* ────────────────────────────── 정의 ────────────────────────────── */

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  /* ───────────── 🧠 LLM (Spec §5.3) ───────────── */
  llm: {
    type: 'llm', label: 'LLM', category: 'Models', icon: 'Brain', mark: 'LM',
    accent: 'llm', priority: 'MUST', compilable: true,
    description: '에이전트가 사용할 언어 모델. 여러 에이전트가 하나를 공유할 수 있습니다.',
    keywords: ['llm', 'model', '모델', 'openai', 'gpt', 'claude', 'gemini', 'groq', 'ollama'],
    inputs: [],
    outputs: [{
      id: 'llm', type: 'llm', direction: 'out', label: 'llm',
      maxConnections: 'unbounded', description: 'Agent.llm / Crew.manager_llm 에 연결',
    }],
    fields: [
      nameField,
      {
        key: 'provider', label: '프로바이더', kind: 'select', required: true, showOnNode: true,
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'gemini', label: 'Google Gemini' },
          { value: 'groq', label: 'Groq', hint: 'litellm 경유' },
          { value: 'ollama', label: 'Ollama (로컬 · 무료)' },
          { value: 'openai_compatible', label: 'OpenAI 호환 엔드포인트' },
        ],
      },
      {
        key: 'model', label: '모델', kind: 'combobox', required: true, showOnNode: true,
        placeholder: 'gpt-4o-mini',
        hint: 'Ollama 선택 시 실제 설치된 모델만 표시됩니다.',
      },
      { key: 'temperature', label: 'Temperature', kind: 'slider', min: 0, max: 2, step: 0.05 },
      { key: 'max_tokens', label: 'Max Tokens', kind: 'number', advanced: true, min: 1, hint: '비우면 프로바이더 기본값' },
      { key: 'top_p', label: 'Top P', kind: 'slider', advanced: true, min: 0, max: 1, step: 0.05 },
      {
        key: 'base_url', label: 'Base URL', kind: 'text', advanced: true,
        placeholder: 'https://api.example.com/v1',
        hint: 'openai_compatible / ollama 전용',
      },
      { key: 'timeout_s', label: '타임아웃(초)', kind: 'number', advanced: true, min: 1 },
    ],
    defaults: {
      name: 'New LLM', provider: 'openai', model: 'gpt-4o-mini',
      temperature: 0.7, max_tokens: null, top_p: 1.0, base_url: null, timeout_s: 120,
    },
  },

  /* ───────────── 🤖 Agent (Spec §5.4) ───────────── */
  agent: {
    type: 'agent', label: 'Agent', category: 'Agents', icon: 'Bot', mark: 'AG',
    accent: 'agent', priority: 'MUST', compilable: true,
    description: '역할·목표·배경을 가진 실행 주체.',
    keywords: ['agent', '에이전트', 'role', 'worker', 'persona'],
    inputs: [
      { id: 'llm', type: 'llm', direction: 'in', label: 'llm', maxConnections: 1,
        description: '비우면 Crew 기본 LLM 을 씁니다' },
      { id: 'tool', type: 'tool', direction: 'in', label: 'tools', maxConnections: 'unbounded' },
      { id: 'knowledge', type: 'knowledge', direction: 'in', label: 'knowledge', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'agent', type: 'agent', direction: 'out', label: 'agent', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'role', label: '역할 (Role)', kind: 'text', required: true, showOnNode: true,
        placeholder: '예: Senior Market Researcher' },
      { key: 'goal', label: '목표 (Goal)', kind: 'textarea', required: true, rows: 3, showOnNode: true,
        placeholder: '예: {topic} 의 최신 동향을 발굴한다', interpolatesVars: true },
      { key: 'backstory', label: '배경 (Backstory)', kind: 'textarea', required: true, rows: 3,
        placeholder: '이 에이전트의 전문성과 페르소나' },
      { key: 'allow_delegation', label: '다른 에이전트에게 위임 허용', kind: 'toggle' },
      { key: 'verbose', label: '상세 로깅', kind: 'toggle' },
      { key: 'max_iter', label: '최대 반복', kind: 'number', advanced: true, min: 1,
        hint: '무한루프 방지. CrewAI 기본값은 25입니다.' },
      { key: 'max_rpm', label: '분당 요청 제한', kind: 'number', advanced: true, min: 1 },
      { key: 'cache', label: '툴 결과 캐싱', kind: 'toggle', advanced: true },
      { key: 'respect_context_window', label: '컨텍스트 윈도 준수', kind: 'toggle', advanced: true },
      { key: 'max_execution_time', label: '최대 실행 시간(초)', kind: 'number', advanced: true, min: 1 },
      { key: 'allow_code_execution', label: '코드 실행 허용 (safe 모드)', kind: 'toggle', advanced: true,
        hint: 'Docker 샌드박스가 필요합니다. 신뢰할 수 없는 입력에는 켜지 마세요.' },
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
    type: 'task', label: 'Task', category: 'Tasks', icon: 'ClipboardList', mark: 'TK',
    accent: 'task', priority: 'MUST', compilable: true,
    description: '에이전트가 수행할 단위 작업.',
    keywords: ['task', '태스크', '작업', 'job', 'step'],
    inputs: [
      { id: 'agent', type: 'agent', direction: 'in', label: 'agent', maxConnections: 1, required: true },
      { id: 'context', type: 'context', direction: 'in', label: 'depends on', maxConnections: 'unbounded',
        description: '먼저 끝나야 하는 다른 Task' },
      { id: 'tool', type: 'tool', direction: 'in', label: 'tools', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'task', type: 'task', direction: 'out', label: 'next', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'description', label: '작업 설명', kind: 'textarea', required: true, rows: 5, showOnNode: true,
        placeholder: '무엇을 어떻게 해야 하는지. {변수} 보간을 지원합니다.', interpolatesVars: true },
      { key: 'expected_output', label: '기대 산출물', kind: 'textarea', required: true, rows: 3,
        placeholder: '결과물의 형식을 구체적으로. CrewAI 품질을 좌우합니다.', interpolatesVars: true },
      { key: 'async_execution', label: '비동기 실행', kind: 'toggle' },
      { key: 'human_input', label: '완료 후 사람 검토', kind: 'toggle' },
      { key: 'markdown', label: '마크다운 출력 유도', kind: 'toggle' },
      { key: 'output_file', label: '결과 파일 경로', kind: 'text', advanced: true,
        hint: 'WORKSPACE_DIR 하위로 제한됩니다.' },
      { key: 'max_retries', label: '재시도 횟수', kind: 'number', advanced: true, min: 0 },
    ],
    defaults: {
      name: 'New Task', description: '', expected_output: '',
      async_execution: false, human_input: false, markdown: true,
      output_file: null, max_retries: null,
    },
  },

  /* ───────────── 🛠️ Tool (Spec §5.6) ───────────── */
  tool: {
    type: 'tool', label: 'Tool', category: 'Tools', icon: 'Wrench', mark: 'TL',
    accent: 'tool', priority: 'MUST', compilable: true,
    description: '에이전트가 호출할 수 있는 외부 기능.',
    keywords: ['tool', '툴', 'search', 'scrape', 'file', '검색'],
    inputs: [],
    outputs: [{ id: 'tool', type: 'tool', direction: 'out', label: 'tool', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'tool_id', label: '툴 종류', kind: 'select', required: true, showOnNode: true,
        hint: '목록은 GET /api/v1/tools 로 서버에서 받아옵니다.',
      },
      { key: 'config', label: '설정', kind: 'code',
        hint: '선택한 툴의 JSON Schema 에 따라 폼이 바뀝니다.' },
    ],
    defaults: { name: 'New Tool', tool_id: 'serper_search', config: {} },
  },

  /* ───────────── 🏛️ Crew (Spec §5.7) ───────────── */
  crew: {
    type: 'crew', label: 'Crew', category: 'Flow', icon: 'Landmark', mark: 'CR',
    accent: 'crew', priority: 'MUST', compilable: true,
    description: '오케스트레이터. 캔버스에 정확히 하나만 존재해야 합니다.',
    keywords: ['crew', '크루', 'orchestrator', 'process', 'root'],
    inputs: [
      { id: 'agent', type: 'agent', direction: 'in', label: 'agents', maxConnections: 'unbounded' },
      { id: 'task', type: 'task', direction: 'in', label: 'tasks', maxConnections: 'unbounded' },
      { id: 'llm', type: 'llm', direction: 'in', label: 'manager llm', maxConnections: 1,
        description: 'hierarchical 프로세스에서 필수' },
      { id: 'memory', type: 'memory', direction: 'in', label: 'memory', maxConnections: 1 },
      { id: 'knowledge', type: 'knowledge', direction: 'in', label: 'knowledge', maxConnections: 'unbounded' },
    ],
    outputs: [{ id: 'result', type: 'result', direction: 'out', label: 'result', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'process', label: '실행 방식', kind: 'select', required: true, showOnNode: true,
        options: [
          { value: 'sequential', label: 'Sequential — 순차 실행' },
          { value: 'hierarchical', label: 'Hierarchical — 매니저가 위임', hint: 'Manager LLM 필수' },
        ],
      },
      { key: 'verbose', label: '상세 로깅', kind: 'toggle' },
      { key: 'memory', label: '단기 메모리 사용', kind: 'toggle',
        hint: 'Memory 노드를 연결하면 그 설정이 우선합니다.' },
      { key: 'cache', label: '툴 결과 캐싱', kind: 'toggle' },
      { key: 'planning', label: '실행 전 계획 수립', kind: 'toggle', advanced: true },
      { key: 'max_rpm', label: '분당 요청 제한', kind: 'number', advanced: true, min: 1 },
    ],
    // RECON F3: full_output 은 CrewAI 1.15.18 에 존재하지 않으므로 필드 없음
    defaults: {
      name: 'My Crew', process: 'sequential', verbose: true,
      memory: false, cache: true, planning: false, max_rpm: null,
    },
  },

  /* ───────────── 📥 Input (Spec §5.8) ───────────── */
  input: {
    type: 'input', label: 'Input', category: 'Data', icon: 'LogIn', mark: 'IN',
    accent: 'input', priority: 'MUST', compilable: true,
    description: '실행할 때 사람이 채우는 변수. Task 설명의 {변수} 와 이어집니다.',
    keywords: ['input', '입력', 'variable', '변수', 'prompt', 'param'],
    inputs: [],
    outputs: [{ id: 'text', type: 'text', direction: 'out', label: 'text', maxConnections: 'unbounded' }],
    fields: [
      { key: 'var_name', label: '변수명', kind: 'text', required: true, showOnNode: true,
        placeholder: 'topic', hint: '영문/숫자/밑줄만. Task 에서 {topic} 으로 참조합니다.' },
      { key: 'label', label: '표시 라벨', kind: 'text', required: true, showOnNode: true,
        placeholder: '블로그 주제' },
      {
        key: 'input_type', label: '입력 형태', kind: 'select',
        options: [
          { value: 'text', label: '한 줄 텍스트' },
          { value: 'textarea', label: '여러 줄 텍스트' },
          { value: 'number', label: '숫자' },
          { value: 'select', label: '목록에서 선택' },
        ],
      },
      { key: 'default_value', label: '기본값', kind: 'text' },
      { key: 'options', label: '선택지', kind: 'tags', visibleWhen: { key: 'input_type', equals: 'select' } },
      { key: 'required', label: '필수 입력', kind: 'toggle' },
      { key: 'description', label: '도움말', kind: 'text', advanced: true },
    ],
    defaults: {
      var_name: 'topic', label: '입력값', input_type: 'text',
      default_value: '', options: [], required: true, description: '',
    },
  },

  /* ───────────── 📤 Output (Spec §5.9) ───────────── */
  output: {
    type: 'output', label: 'Output', category: 'Data', icon: 'LogOut', mark: 'OU',
    accent: 'output', priority: 'MUST', compilable: true,
    description: '최종 결과를 캔버스에서 바로 읽습니다.',
    keywords: ['output', '출력', 'result', '결과', 'report'],
    inputs: [
      { id: 'result', type: 'result', direction: 'in', label: 'result', maxConnections: 1 },
      { id: 'task', type: 'task', direction: 'in', label: 'tasks', maxConnections: 'unbounded' },
    ],
    outputs: [],
    fields: [
      { key: 'title', label: '제목', kind: 'text', showOnNode: true },
      {
        key: 'render_as', label: '표시 형식', kind: 'select',
        options: [
          { value: 'markdown', label: 'Markdown' },
          { value: 'plain', label: '일반 텍스트' },
          { value: 'json', label: 'JSON' },
        ],
      },
      { key: 'allow_download', label: '다운로드 버튼 노출', kind: 'toggle' },
    ],
    defaults: { title: '실행 결과', render_as: 'markdown', allow_download: true },
  },

  /* ───────────── 📚 Knowledge (Spec §5.10) ───────────── */
  knowledge: {
    type: 'knowledge', label: 'Knowledge', category: 'Data', icon: 'BookOpen', mark: 'KN',
    accent: 'knowledge', priority: 'SHOULD', compilable: true,
    description: '에이전트가 참조할 지식원 (RAG).',
    keywords: ['knowledge', '지식', 'rag', 'document', '문서', 'pdf'],
    inputs: [],
    outputs: [{ id: 'knowledge', type: 'knowledge', direction: 'out', label: 'knowledge', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      {
        key: 'source_type', label: '원본 종류', kind: 'select', showOnNode: true,
        options: [
          { value: 'text', label: '직접 입력' },
          { value: 'file', label: '파일 업로드' },
          { value: 'url', label: 'URL' },
        ],
      },
      { key: 'content', label: '내용', kind: 'textarea', rows: 5,
        visibleWhen: { key: 'source_type', equals: 'text' } },
      { key: 'file_ref', label: '업로드된 파일', kind: 'file',
        visibleWhen: { key: 'source_type', equals: 'file' },
        hint: '파일 본문은 그래프에 저장되지 않고 참조 ID 만 남습니다.' },
      { key: 'url', label: 'URL', kind: 'text', visibleWhen: { key: 'source_type', equals: 'url' } },
      { key: 'chunk_size', label: '청크 크기', kind: 'number', advanced: true, min: 200 },
      { key: 'chunk_overlap', label: '청크 겹침', kind: 'number', advanced: true, min: 0 },
    ],
    defaults: {
      name: 'Knowledge', source_type: 'text', content: '', file_ref: null, url: '',
      chunk_size: 4000, chunk_overlap: 200,
    },
  },

  /* ───────────── 🧩 Memory (Spec §5.10) ───────────── */
  memory: {
    type: 'memory', label: 'Memory', category: 'Data', icon: 'Puzzle', mark: 'ME',
    accent: 'memory', priority: 'SHOULD', compilable: true,
    description: 'Crew 의 메모리 설정. 연결하지 않으면 Crew 의 memory 토글만 사용합니다.',
    keywords: ['memory', '메모리', 'short term', 'long term'],
    inputs: [],
    outputs: [{ id: 'memory', type: 'memory', direction: 'out', label: 'memory', maxConnections: 'unbounded' }],
    fields: [
      nameField,
      { key: 'short_term', label: '단기 메모리', kind: 'toggle', showOnNode: true },
      { key: 'long_term', label: '장기 메모리', kind: 'toggle' },
      { key: 'entity', label: '엔티티 메모리', kind: 'toggle' },
      { key: 'storage_path', label: '저장 경로', kind: 'text', advanced: true },
    ],
    defaults: { name: 'Memory', short_term: true, long_term: false, entity: false, storage_path: null },
  },

  /* ───────────── 🙋 Human Input (Spec §5.10) ───────────── */
  human: {
    type: 'human', label: 'Human Input', category: 'Flow', icon: 'UserRoundCheck', mark: 'HU',
    accent: 'human', priority: 'SHOULD', compilable: true,
    description: 'Task 완료 시점에 사람 승인을 받습니다.',
    keywords: ['human', '사람', 'approval', '승인', 'hitl', 'review'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'after task', maxConnections: 'unbounded' }],
    outputs: [],
    fields: [
      nameField,
      { key: 'prompt', label: '검토 요청 문구', kind: 'textarea', rows: 3, showOnNode: true },
      { key: 'timeout_s', label: '대기 시간(초)', kind: 'number', min: 10 },
      {
        key: 'on_timeout', label: '시간 초과 시', kind: 'select',
        options: [
          { value: 'abort', label: '실행 중단' },
          { value: 'continue', label: '승인으로 간주하고 계속' },
        ],
      },
    ],
    defaults: { name: 'Human Review', prompt: '이 결과를 승인하시겠습니까?', timeout_s: 300, on_timeout: 'abort' },
  },

  /* ───────────── 🔀 Router (v1.1) ───────────── */
  router: {
    type: 'router', label: 'Router', category: 'Flow', icon: 'GitBranch', mark: 'RT',
    accent: 'router', priority: 'MAY', compilable: true, disabledInV1: true,
    description: '조건에 따라 흐름을 분기합니다. (v1.1 예정)',
    keywords: ['router', '분기', 'condition', 'if', 'branch'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'from', maxConnections: 'unbounded' }],
    outputs: [
      { id: 'true', type: 'task', direction: 'out', label: 'match', maxConnections: 'unbounded' },
      { id: 'false', type: 'task', direction: 'out', label: 'else', maxConnections: 'unbounded' },
    ],
    fields: [
      nameField,
      {
        key: 'mode', label: '판정 방식', kind: 'select',
        options: [
          { value: 'keyword', label: '키워드 포함' },
          { value: 'regex', label: '정규식' },
          { value: 'llm_judge', label: 'LLM 판단' },
        ],
      },
      { key: 'condition', label: '조건', kind: 'text', showOnNode: true },
    ],
    defaults: { name: 'Router', mode: 'keyword', condition: '' },
  },

  /* ───────────── 🛡️ Guardrail (v1.1) ───────────── */
  guardrail: {
    type: 'guardrail', label: 'Guardrail', category: 'Flow', icon: 'ShieldCheck', mark: 'GR',
    accent: 'router', priority: 'MAY', compilable: true, disabledInV1: true,
    description: 'Task 출력을 검증하고 실패 시 재시도시킵니다. (v1.1 예정)',
    keywords: ['guardrail', '검증', 'validate', 'schema'],
    inputs: [{ id: 'task', type: 'task', direction: 'in', label: 'validates', maxConnections: 'unbounded' }],
    outputs: [],
    fields: [
      nameField,
      {
        key: 'type', label: '검증 종류', kind: 'select',
        options: [
          { value: 'length', label: '길이' },
          { value: 'json_schema', label: 'JSON 스키마' },
          { value: 'llm_check', label: 'LLM 검사' },
        ],
      },
      { key: 'retry_count', label: '재시도 횟수', kind: 'number', min: 0 },
    ],
    defaults: { name: 'Guardrail', type: 'length', retry_count: 2 },
  },

  /* ───────────── 📝 Note (Spec §5.10) ───────────── */
  note: {
    type: 'note', label: 'Note', category: 'Utils', icon: 'StickyNote', mark: 'NT',
    accent: 'note', priority: 'SHOULD', compilable: false,
    description: '실행에 영향을 주지 않는 마크다운 메모.',
    keywords: ['note', '메모', 'comment', '주석', 'markdown'],
    inputs: [], outputs: [],
    fields: [{ key: 'text', label: '메모', kind: 'textarea', rows: 6, showOnNode: true }],
    defaults: { text: '## 메모\n\n여기에 설명을 적으세요.' },
  },

  /* ───────────── 🗂️ Group (Spec §5.10) ───────────── */
  group: {
    type: 'group', label: 'Group', category: 'Utils', icon: 'Group', mark: 'GP',
    accent: 'group', priority: 'SHOULD', compilable: false,
    description: '노드를 묶는 배경 프레임. 함께 이동합니다.',
    keywords: ['group', '그룹', 'frame', '프레임'],
    inputs: [], outputs: [],
    fields: [
      { key: 'title', label: '제목', kind: 'text', showOnNode: true },
      { key: 'color', label: '색', kind: 'select', options: [
        { value: 'note', label: '기본 (슬레이트)' },
        { value: 'agent', label: '인디고' },
        { value: 'task', label: '에메랄드' },
        { value: 'tool', label: '앰버' },
        { value: 'llm', label: '로즈' },
      ] },
    ],
    defaults: { title: '그룹', color: 'note' },
  },
};

/* ────────────────────────────── 조회 헬퍼 ────────────────────────────── */

export function getNodeDef(type: NodeType): NodeDefinition {
  const def = NODE_DEFINITIONS[type];
  if (!def) throw new Error(`알 수 없는 노드 타입: ${type}`);
  return def;
}

export function getPort(type: NodeType, portId: string) {
  const def = getNodeDef(type);
  return [...def.inputs, ...def.outputs].find((p) => p.id === portId);
}

export function defaultDataFor(type: NodeType): Record<string, unknown> {
  return structuredClone(getNodeDef(type).defaults);
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
    const hay = [d.label, d.type, ...d.keywords].map((s) => s.toLowerCase());
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
