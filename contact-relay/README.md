# Kite 문의 중계 (Brevo)

Kite 의 "도구 → 문의하기" 창이 보낸 내용을 Brevo 로 개발사 메일에 전달하는 Vercel 함수입니다.
Brevo API 키와 받는 주소는 서버 환경 변수에만 두어, 앱에서 꺼낼 수 없습니다.

## 배포

```
cd contact-relay
vercel deploy --prod
```

Vercel 프로젝트 설정 → Environment Variables 에 세 값을 넣고 다시 배포합니다.

| 이름 | 값 |
|---|---|
| `BREVO_API_KEY` | Brevo → SMTP & API → API Keys 에서 만든 키 |
| `CONTACT_TO` | 문의를 받을 주소 |
| `CONTACT_SENDER` | Brevo 에서 확인한 보내는 주소 (Senders) |

배포 주소의 `/api/contact` 를 Kite 의 `src/appInfo.ts` → `CONTACT_FORM_ENDPOINT` 에 넣습니다.

## 지키는 것

- 받는 사람은 `CONTACT_TO` 하나로 고정. 사용자가 적은 메일 주소는 답장 주소(replyTo)로만 쓴다
- 주소(IP)마다 10분에 5건, 내용 9,000자까지
