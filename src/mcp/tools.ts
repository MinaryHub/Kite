/**
 * Kite 가 MCP 로 제공하는 도구 정의 (주 프로세스의 MCP 다리와 렌더러의 처리기가 함께 쓴다).
 * 도구는 열려 있는 문서 안에서만 동작한다. 파일 열기/저장/삭제 같은 디스크 접근은 주지 않는다.
 */

export interface McpToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  /** 문서를 바꾸는 도구 */
  edits: boolean;
}

const docId = {
  type: 'string',
  description: '문서 id (list_documents 결과). 생략하면 Kite 에서 지금 보고 있는 문서.',
};

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_documents',
    title: '열린 문서 목록',
    description: 'Kite 에 열려 있는 문서 목록을 돌려준다 (id, 제목, 쪽 수, 블록 수, 지금 보고 있는 문서인지, 저장하지 않은 변경이 있는지).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    edits: false,
  },
  {
    name: 'read_document',
    title: '문서 읽기',
    description:
      '문서 내용을 Markdown 으로 읽는다. 각 최상위 블록(문단, 제목, 표, 목록 등) 앞에 <!-- block N --> 표시가 붙는다. ' +
      '블록 번호는 0 부터이며 insert_content / replace_blocks 의 위치로 쓴다. 긴 문서는 from_block/to_block 으로 나눠 읽는다. 그림은 [그림] 으로만 표시된다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        from_block: { type: 'integer', minimum: 0, description: '읽기 시작할 블록 번호 (기본 0)' },
        to_block: { type: 'integer', minimum: 0, description: '마지막으로 읽을 블록 번호 (포함, 기본 끝까지)' },
        max_chars: { type: 'integer', minimum: 1000, maximum: 200000, description: '돌려줄 최대 글자 수 (기본 40000)' },
      },
      additionalProperties: false,
    },
    edits: false,
  },
  {
    name: 'get_selection',
    title: '선택 영역 읽기',
    description: '사용자가 Kite 에서 선택한 부분을 Markdown 으로 돌려준다. 선택이 없으면 커서가 있는 블록 번호만 돌려준다.',
    inputSchema: { type: 'object', properties: { document_id: docId }, additionalProperties: false },
    edits: false,
  },
  {
    name: 'insert_content',
    title: '내용 넣기',
    description:
      'Markdown 내용을 문서에 넣는다 (제목, 목록, 굵게/기울임, GFM 표 지원). position: cursor(커서 위치, 기본) | start | end | after_block | before_block. ' +
      'after_block / before_block 은 block 번호가 필요하다. 사용자는 Ctrl+Z 로 되돌릴 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        markdown: { type: 'string', description: '넣을 내용 (Markdown)' },
        position: { type: 'string', enum: ['cursor', 'start', 'end', 'after_block', 'before_block'] },
        block: { type: 'integer', minimum: 0, description: 'after_block / before_block 의 기준 블록 번호' },
      },
      required: ['markdown'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'replace_selection',
    title: '선택 영역 바꾸기',
    description: '사용자가 선택한 부분을 Markdown 내용으로 바꾼다. 선택이 없으면 오류를 돌려준다.',
    inputSchema: {
      type: 'object',
      properties: { document_id: docId, markdown: { type: 'string' } },
      required: ['markdown'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'replace_blocks',
    title: '블록 바꾸기',
    description: 'from_block 부터 to_block 까지(포함)의 블록을 Markdown 내용으로 바꾼다. markdown 을 빈 문자열로 주면 그 블록들을 지운다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        from_block: { type: 'integer', minimum: 0 },
        to_block: { type: 'integer', minimum: 0 },
        markdown: { type: 'string' },
      },
      required: ['from_block', 'to_block', 'markdown'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'find_replace',
    title: '찾아 바꾸기',
    description: '문서에서 글자를 찾아 바꾼다 (한 문단 안에서만 찾는다). 서식은 찾은 글자의 첫 글자 서식을 따른다. 바꾼 개수를 돌려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        find: { type: 'string', minLength: 1 },
        replace: { type: 'string' },
        regex: { type: 'boolean', description: '정규식으로 찾기 (기본 false). replace 에서 $1 등 사용 가능' },
        match_case: { type: 'boolean', description: '대소문자 구분 (기본 true)' },
        max: { type: 'integer', minimum: 1, maximum: 1000, description: '최대 바꿀 개수 (기본 1000)' },
      },
      required: ['find', 'replace'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'get_outline',
    title: '문서 개요',
    description: '문서의 제목(장·절) 목록을 블록 번호와 함께 돌려준다. 긴 문서에서 읽을 부분을 고를 때 먼저 쓴다. 표·그림 개수와 메모·변경 제안 수도 함께 알려 준다.',
    inputSchema: { type: 'object', properties: { document_id: docId }, additionalProperties: false },
    edits: false,
  },
  {
    name: 'apply_style',
    title: '문단 모양 적용',
    description: 'from_block 부터 to_block 까지(포함)의 문단에 스타일을 적용한다. style: p(바탕글) | body(본문, 들여쓰기) | h1–h6(제목 1–6) | quote(인용) | code(코드).',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        from_block: { type: 'integer', minimum: 0 },
        to_block: { type: 'integer', minimum: 0 },
        style: { type: 'string', enum: ['p', 'body', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'code'] },
      },
      required: ['from_block', 'to_block', 'style'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'insert_table',
    title: '표 넣기',
    description: '표를 넣는다. rows 는 행 배열이며 각 행은 칸 글자 배열이다. header 가 true 면 첫 행을 머리글로 쓴다 (기본 true). 위치는 insert_content 와 같다 (기본 커서 뒤 문단).',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        rows: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } } },
        header: { type: 'boolean' },
        position: { type: 'string', enum: ['cursor', 'start', 'end', 'after_block', 'before_block'] },
        block: { type: 'integer', minimum: 0 },
      },
      required: ['rows'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'list_comments',
    title: '메모 목록',
    description: '문서의 메모를 돌려준다 (id, 작성자, 내용, 답글, 해결 여부, 메모가 달린 본문 글자와 블록 번호).',
    inputSchema: {
      type: 'object',
      properties: { document_id: docId, include_resolved: { type: 'boolean', description: '해결한 메모도 포함 (기본 false)' } },
      additionalProperties: false,
    },
    edits: false,
  },
  {
    name: 'add_comment',
    title: '메모 달기',
    description:
      '본문에 메모를 단다. quote 로 메모를 달 글자를 정한다 (문단 안에서 찾는 첫 번째, 또는 occurrence 번째). quote 대신 block 을 주면 그 블록 전체에 단다. 작성자는 AI 앱 이름으로 남는다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        text: { type: 'string', minLength: 1, description: '메모 내용' },
        quote: { type: 'string', description: '메모를 달 본문 글자 (한 문단 안)' },
        occurrence: { type: 'integer', minimum: 1, description: 'quote 가 여러 번 나올 때 몇 번째인지 (기본 1)' },
        block: { type: 'integer', minimum: 0, description: 'quote 대신 블록 전체에 달 때' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'reply_comment',
    title: '메모에 답글',
    description: '메모에 답글을 단다 (comment_id 는 list_comments 결과). resolve 를 true 로 주면 답글을 달고 해결로 표시한다.',
    inputSchema: {
      type: 'object',
      properties: { document_id: docId, comment_id: { type: 'string' }, text: { type: 'string' }, resolve: { type: 'boolean' } },
      required: ['comment_id'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'list_changes',
    title: '변경 제안 목록',
    description: '문서의 변경 제안(변경 내용 추적의 넣음/지움)을 돌려준다. 각 항목은 change_ids, 작성자, 종류, 글자, 블록 번호를 가진다. 변경 내용 기록이 켜져 있는지도 알려 준다.',
    inputSchema: { type: 'object', properties: { document_id: docId }, additionalProperties: false },
    edits: false,
  },
  {
    name: 'resolve_changes',
    title: '변경 받아들이기/되돌리기',
    description: '변경 제안을 받아들이거나(accept) 되돌린다(reject). change_ids 를 주면 그 변경만, all 이 true 면 전체를 처리한다.',
    inputSchema: {
      type: 'object',
      properties: {
        document_id: docId,
        action: { type: 'string', enum: ['accept', 'reject'] },
        change_ids: { type: 'array', items: { type: 'string' }, maxItems: 1000 },
        all: { type: 'boolean' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    edits: true,
  },
  {
    name: 'save_document',
    title: '문서 저장',
    description: '문서를 원래 파일에 저장한다. 사용자에게 항상 확인을 받는다. 아직 파일로 저장한 적이 없는 새 문서는 저장할 수 없다 (사용자가 직접 위치를 정해야 한다).',
    inputSchema: { type: 'object', properties: { document_id: docId }, additionalProperties: false },
    edits: true,
  },
];

export const MCP_TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));

/** 주 프로세스 ↔ 렌더러 사이의 도구 호출 */
export interface McpCall {
  callId: string;
  client: string;
  name: string;
  args: Record<string, any>;
  /** 문서를 고칠 때마다 사용자 확인 */
  confirmEdits: boolean;
}

export interface McpResult {
  callId: string;
  ok: boolean;
  text: string;
}
