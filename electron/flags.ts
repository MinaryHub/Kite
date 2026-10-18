/** Microsoft Store(MSIX)로 설치된 판인지 (KITE_STORE=1 로 흉내 낼 수 있다) */
export const STORE_BUILD = !!(process as any).windowsStore || process.env.KITE_STORE === '1';

/** 스토어판 MSIX 매니페스트(build/appx/extensions.xml)의 실행 별칭. AI 앱이 Kite 를 MCP 서버로 실행할 때 쓴다 */
export const STORE_EXEC_ALIAS = 'kite-word.exe';
