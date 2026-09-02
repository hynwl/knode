/** 에러 코드 체계 (Spec §22.1) — 프론트/백엔드 공통 어휘 */

export type Severity = 'error' | 'warn';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  hint?: string;
  nodeId?: string | null;
  edgeId?: string | null;
  field?: string | null;
}

interface IssueTemplate {
  severity: Severity;
  message: string;
  hint: string;
}

/**
 * Spec §22.1 전 코드.
 * 모든 에러는 코드 + 노드 + 다음 행동(hint) 세 가지를 갖는다. (Spec §17.4)
 */
export const ISSUE_CATALOG: Record<string, IssueTemplate> = {
  // E1xx — 그래프 구조
  'AC-E101': { severity: 'error', message: 'Crew 노드가 없습니다', hint: '우클릭 → Flow → Crew 를 추가하세요.' },
  'AC-E102': { severity: 'error', message: 'Crew 노드가 2개 이상입니다', hint: '하나만 남기세요.' },
  'AC-E103': { severity: 'error', message: 'hierarchical 프로세스에는 Manager LLM 이 필요합니다', hint: 'Crew 의 manager llm 소켓에 LLM 을 연결하세요.' },
  'AC-W104': { severity: 'warn', message: 'Crew 에 연결되지 않은 노드가 있습니다', hint: '실행에서 제외됩니다.' },
  'AC-E105': { severity: 'error', message: '순환 의존이 감지되었습니다', hint: 'Task 의 depends on 연결을 확인하세요.' },
  'AC-E106': { severity: 'error', message: '호환되지 않는 포트 연결입니다', hint: '같은 색 소켓끼리만 연결할 수 있습니다.' },
  'AC-E107': { severity: 'error', message: 'Crew 에 Task 가 없습니다', hint: '최소 1개의 Task 를 Crew 에 연결하세요.' },

  // E2xx — 노드 설정
  'AC-E201': { severity: 'error', message: '필수 항목이 비어 있습니다', hint: '역할·목표·배경을 모두 채우세요.' },
  'AC-E202': { severity: 'error', message: 'Task 에 Agent 가 연결되지 않았습니다', hint: 'Agent 의 출력을 Task 의 agent 소켓에 연결하세요.' },
  'AC-W203': { severity: 'warn', message: 'Agent 에 연결된 Task 가 없습니다', hint: '이 에이전트는 아무 일도 하지 않습니다.' },
  'AC-E204': { severity: 'error', message: 'Task 의 설명 또는 기대 산출물이 비어 있습니다', hint: '두 항목 모두 CrewAI 품질에 직접 영향을 줍니다.' },
  'AC-E205': { severity: 'error', message: '알 수 없는 툴입니다', hint: '툴 종류를 다시 선택하세요.' },
  'AC-E206': { severity: 'error', message: '툴 설정이 스키마에 맞지 않습니다', hint: '필수 설정값을 확인하세요.' },

  // E3xx — 변수/보간
  'AC-W301': { severity: 'warn', message: '정의되지 않은 변수를 참조합니다', hint: 'Input 노드를 추가하거나 변수명을 고치세요.' },
  'AC-E302': { severity: 'error', message: '필수 입력값이 제공되지 않았습니다', hint: '실행 파라미터를 채우세요.' },
  'AC-E303': { severity: 'error', message: '잘못된 변수명 형식입니다', hint: '영문으로 시작하고 영문·숫자·밑줄만 사용하세요.' },

  // E4xx — 파일/스키마
  'AC-E401': { severity: 'error', message: '지원하지 않는 스키마 버전입니다', hint: '파일이 손상되었을 수 있습니다.' },
  'AC-E402': { severity: 'error', message: '더 최신 버전에서 만든 파일입니다', hint: '앱을 업데이트하세요.' },
  'AC-E403': { severity: 'error', message: '파일이 손상되었거나 형식이 올바르지 않습니다', hint: 'JSON 구조를 확인하세요.' },
  'AC-E404': { severity: 'error', message: '파일에 API 키로 보이는 값이 포함되어 있습니다', hint: '해당 필드에서 키를 지운 뒤 다시 내보내세요.' },
  'AC-E405': { severity: 'error', message: 'LocalStorage 용량이 부족합니다', hint: '오래된 프로젝트를 정리하거나 파일로 내보내세요.' },

  // E5xx — 실행/런타임
  'AC-E501': { severity: 'error', message: '실행 중 오류가 발생했습니다', hint: '로그 패널에서 상세 내용을 확인하세요.' },
  'AC-E502': { severity: 'error', message: '최대 실행 시간을 초과했습니다', hint: '태스크를 나누거나 제한 시간을 늘리세요.' },
  'AC-E503': { severity: 'error', message: '동시 실행 한도를 초과했습니다', hint: '진행 중인 실행이 끝난 뒤 다시 시도하세요.' },
  'AC-E504': { severity: 'error', message: '백엔드에 연결할 수 없습니다', hint: '백엔드가 떠 있는지 확인하세요. 편집·저장은 계속 가능합니다.' },
  'AC-E505': { severity: 'error', message: '실행이 취소되었습니다', hint: '' },
  'AC-E506': { severity: 'error', message: '실행을 찾을 수 없습니다', hint: 'run_id를 확인하세요. 완료 후 30분이 지나면 기록이 사라집니다.' },
  'AC-E507': { severity: 'error', message: '사람 검토 대기 시간을 초과했습니다', hint: 'Human Input 노드의 대기 시간을 늘리거나, 시간 초과 동작을 승인으로 간주하고 계속으로 바꾸세요.' },
  'AC-E508': { severity: 'error', message: '대기 중인 사람 검토 요청이 없습니다', hint: '이미 응답했거나 시간이 초과된 요청입니다. 실행 로그를 확인하세요.' },

  // E6xx — 프로바이더/키
  'AC-E601': { severity: 'error', message: 'API 키가 유효하지 않습니다 (401/403)', hint: 'API Keys 설정에서 키를 다시 확인하세요.' },
  'AC-E602': { severity: 'error', message: '필요한 API 키가 설정되지 않았습니다', hint: 'API Keys 설정에서 키를 입력하세요.' },
  'AC-E603': { severity: 'error', message: '요청 한도(rate limit)에 도달했습니다', hint: '잠시 후 다시 시도하세요.' },
  'AC-E604': { severity: 'error', message: '모델을 찾을 수 없습니다', hint: '모델명을 확인하세요.' },

  // E7xx — Ollama/로컬
  'AC-E701': { severity: 'error', message: 'Ollama 서버에 연결할 수 없습니다', hint: '터미널에서 `ollama serve` 를 실행하세요.' },
  'AC-W701': { severity: 'warn', message: '이 로컬 모델은 툴 호출이 불안정할 수 있습니다', hint: '툴을 쓰는 에이전트에는 더 큰 모델을 권장합니다.' },
  'AC-E702': { severity: 'error', message: '선택한 모델이 설치되어 있지 않습니다', hint: '`ollama pull <model>` 로 내려받으세요.' },

  // E8xx — 보안
  'AC-E801': { severity: 'error', message: '내부 네트워크 주소 접근이 차단되었습니다', hint: '공개 URL 을 사용하세요.' },
  'AC-E802': { severity: 'error', message: '작업 디렉터리 밖의 파일에 접근할 수 없습니다', hint: 'WORKSPACE_DIR 안의 경로를 지정하세요.' },
  'AC-E803': { severity: 'error', message: '코드 실행 도구가 비활성화되어 있습니다', hint: 'ENABLE_CODE_INTERPRETER 를 켜고 Docker 샌드박스를 준비하세요.' },
};

export function issue(
  code: keyof typeof ISSUE_CATALOG | string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  const t = ISSUE_CATALOG[code];
  return {
    code,
    severity: extra.severity ?? t?.severity ?? 'error',
    message: extra.message ?? t?.message ?? code,
    hint: extra.hint ?? t?.hint,
    nodeId: extra.nodeId ?? null,
    edgeId: extra.edgeId ?? null,
    field: extra.field ?? null,
  };
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

export const ALL_ISSUE_CODES = Object.keys(ISSUE_CATALOG);
