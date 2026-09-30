import { publicPreview } from '../../public-preview';
/* ============================================================
   문의 — 원본 app/(marketing)/contact/page.tsx +
   components/landing/contact-form.tsx 이식.

   원본이 가진 방어 장치를 그대로 옮겼다.
   · 필드별 검증 + 첫 오류 필드로 포커스 이동(FIELD_ORDER)
   · 허니팟(사람에겐 안 보이는 website 필드)
   · 폼 표시~제출 경과시간 측정(너무 빠르면 봇으로 간주)
   원본은 /api/contact 로 POST 하지만 라일락에는 해당 엔드포인트가
   없으므로, 전송을 시도하되 실패하면 mailto 대체 경로를 안내한다.
   ============================================================ */

import { brand } from '../config';
import { bindSiteMotion } from '../motion';
import { toast } from '../../player';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_ORDER = ['name', 'email', 'org', 'message', 'agree'] as const;
type FieldKey = (typeof FIELD_ORDER)[number];

const PERKS = [
  '데모 화면과 데이터 구조를 직접 보여드립니다',
  '한일 양국 표기 매칭·환율 계산 로직 설명',
  '차트·발매 데이터 연동 방식 협의',
  '레이블·유통사 대상 파일럿 우선 검토',
];

export function contactHtml(): string {
  if (publicPreview) return '<section class="contact-page"><div class="contact-wrap"><header class="contact-head"><h1 class="heading-ko">문의</h1><p>읽기 전용 미리보기에서는 문의를 접수하지 않습니다. 이름·이메일 등 개인정보 입력 폼은 연결되어 있지 않습니다.</p><a href="#/">음악 둘러보기</a></header></div></section>';
  return `
  <section class="contact-page">
    <div class="contact-wrap reveal-up">
      <header class="contact-head">
        <h1 class="heading-ko">도입·제휴 문의</h1>
        <p>담당자가 확인 후 회신드립니다. 데모 단계라 답변까지 며칠 걸릴 수 있습니다.</p>
      </header>

      <div class="contact-perks">
        <p class="kicker">한일 동시 활동 아티스트 · 레이블 · 유통사라면</p>
        <p class="lead heading-ko">먼저 붙여보고 판단하실 수 있게 준비했습니다.</p>
        <ul>
          ${PERKS.map(
            (p) => `<li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
            <span>${p}</span></li>`,
          ).join('')}
        </ul>
      </div>

      <form class="contact-form" data-contact novalidate>
        <div class="field" data-field="name">
          <label for="contact-name">이름<span class="req" aria-hidden="true">*</span></label>
          <input id="contact-name" name="name" type="text" autocomplete="name" placeholder="홍길동" />
          <p class="err" hidden></p>
        </div>

        <div class="field" data-field="email">
          <label for="contact-email">이메일<span class="req" aria-hidden="true">*</span></label>
          <input id="contact-email" name="email" type="email" autocomplete="email" placeholder="name@company.com" />
          <p class="err" hidden></p>
        </div>

        <div class="field" data-field="org">
          <label for="contact-org">소속<span class="req" aria-hidden="true">*</span></label>
          <input id="contact-org" name="org" type="text" autocomplete="organization" placeholder="회사·레이블·팀 이름" />
          <p class="err" hidden></p>
        </div>

        <div class="field" data-field="topic">
          <label for="contact-topic">문의 유형</label>
          <select id="contact-topic" name="topic">
            <option value="partnership">제휴·파일럿</option>
            <option value="data">데이터 연동</option>
            <option value="press">취재·인터뷰</option>
            <option value="bug">서비스 오류 신고</option>
            <option value="etc">기타</option>
          </select>
        </div>

        <div class="field" data-field="message">
          <label for="contact-message">문의 내용<span class="req" aria-hidden="true">*</span></label>
          <textarea id="contact-message" name="message" placeholder="어떤 부분이 궁금하신지 적어 주세요."></textarea>
          <p class="err" hidden></p>
        </div>

        <!-- 허니팟 — 사람에게는 보이지 않는다 -->
        <div aria-hidden="true" hidden>
          <label for="contact-website">Website</label>
          <input id="contact-website" name="website" type="text" tabindex="-1" autocomplete="off" />
        </div>

        <div class="field" data-field="agree">
          <label class="contact-consent" for="contact-agree">
            <input id="contact-agree" name="agree" type="checkbox" />
            <span>
              문의 처리를 위한 개인정보(이름·이메일·소속·문의 내용) 수집·이용에 동의합니다.
              보관 기간은 처리 완료 후 3년입니다.
              자세한 내용은 <a href="#/privacy">개인정보 처리방침</a>을 확인하세요.
            </span>
          </label>
          <p class="err" hidden></p>
        </div>

        <button type="submit" class="contact-submit">문의 보내기</button>
      </form>
    </div>
  </section>`;
}

export function mountContact(root: HTMLElement) {
  bindSiteMotion(root);

  const form = root.querySelector<HTMLFormElement>('[data-contact]');
  if (!form) return;
  const mountedAt = Date.now();

  const fieldEl = (k: string) => form.querySelector<HTMLElement>(`.field[data-field="${k}"]`);
  const setError = (k: FieldKey, msg?: string) => {
    const f = fieldEl(k);
    if (!f) return;
    const p = f.querySelector<HTMLElement>('.err')!;
    f.dataset.invalid = String(Boolean(msg));
    p.hidden = !msg;
    p.textContent = msg || '';
    p.id = `contact-${k}-error`;
    const input = f.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    input?.setAttribute('aria-invalid', String(Boolean(msg)));
    if (msg) input?.setAttribute('aria-describedby', p.id);
    else input?.removeAttribute('aria-describedby');
  };

  const val = (k: string) =>
    (form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#contact-${k}`)?.value || '').trim();

  form.querySelectorAll('input, textarea, select').forEach((el) =>
    el.addEventListener('input', () => {
      const key = (el as HTMLElement).id.replace('contact-', '') as FieldKey;
      if (FIELD_ORDER.includes(key)) setError(key, undefined);
    }),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector<HTMLButtonElement>('.contact-submit')!;
    if (btn.disabled) return;

    const errors: Partial<Record<FieldKey, string>> = {};
    if (!val('name')) errors.name = '이름을 입력해 주세요.';
    const em = val('email');
    if (!em) errors.email = '이메일을 입력해 주세요.';
    else if (!EMAIL_RE.test(em)) errors.email = '올바른 이메일 형식이 아닙니다.';
    if (!val('org')) errors.org = '소속을 입력해 주세요.';
    const msg = val('message');
    if (!msg) errors.message = '문의 내용을 입력해 주세요.';
    else if (msg.length > 4000) errors.message = '문의 내용은 4000자 이내로 입력해 주세요.';
    if (!(form.querySelector<HTMLInputElement>('#contact-agree')!.checked))
      errors.agree = '개인정보 수집·이용에 동의해 주세요.';

    FIELD_ORDER.forEach((k) => setError(k, errors[k]));
    const first = FIELD_ORDER.find((k) => errors[k]);
    if (first) {
      document.getElementById(`contact-${first}`)?.focus();
      return;
    }

    // 봇 방어 — 허니팟이 채워졌거나 제출이 비정상적으로 빠르면 조용히 성공 처리
    const honeypot = val('website');
    const elapsed = Date.now() - mountedAt;
    const suspicious = Boolean(honeypot) || elapsed < 1500;

    btn.disabled = true;
    btn.textContent = '보내는 중…';

    const payload = {
      name: val('name'),
      email: em,
      org: val('org'),
      topic: (form.querySelector<HTMLSelectElement>('#contact-topic')!.value),
      message: msg,
      elapsedMs: elapsed,
    };

    let delivered = suspicious;
    if (!suspicious) {
      try {
        const r = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.status === 400) {
          /* 서버가 필드 단위 오류를 돌려줌 — 메일 대체 경로로 넘기면
             사용자는 뭐가 틀렸는지 모른 채 폼을 떠나게 된다. 폼에 되돌려 표시한다.
             (클라이언트 검사를 통과했는데 서버가 막았다면 두 규칙이 어긋난 것이므로
              그 자체가 드러나야 한다) */
          const body = await r.json().catch(() => null);
          const serverErrors = (body?.errors ?? {}) as Partial<Record<FieldKey, string>>;
          FIELD_ORDER.forEach((k) => setError(k, serverErrors[k]));
          const firstServer = FIELD_ORDER.find((k) => serverErrors[k]);
          if (firstServer) document.getElementById(`contact-${firstServer}`)?.focus();
          btn.disabled = false;
          btn.textContent = '문의 보내기';
          toast('입력을 다시 확인해 주세요');
          return;
        }
        delivered = r.ok;
      } catch {
        delivered = false;
      }
    }

    const wrap = form.parentElement!;
    if (delivered) {
      // 원본은 sonner 토스트를 쓴다. 라일락은 자체 toast 가 있으므로 그걸 재사용한다.
      toast('문의가 접수되었습니다');
      wrap.innerHTML = doneHtml(
        '문의가 접수되었습니다',
        '확인 후 입력하신 이메일로 회신드리겠습니다.',
      );
    } else {
      // 접수 엔드포인트가 아직 없으므로 메일 클라이언트로 대체 경로를 연다.
      const subject = encodeURIComponent(`[Lilac 문의] ${payload.topic} — ${payload.org}`);
      const body = encodeURIComponent(
        `이름: ${payload.name}\n이메일: ${payload.email}\n소속: ${payload.org}\n유형: ${payload.topic}\n\n${payload.message}`,
      );
      wrap.innerHTML = doneHtml(
        '메일로 보내 주세요',
        `데모 단계라 접수 서버가 아직 열려 있지 않습니다. 아래 버튼을 누르면 작성하신 내용이 담긴 메일이 열립니다.`,
        `<a class="btn btn-primary" style="height:2.75rem;padding-inline:1.25rem;margin-top:1.5rem" href="mailto:${brand.company.supportEmail}?subject=${subject}&body=${body}">메일 앱으로 열기</a>`,
      );
    }

    // 제출 결과로 포커스를 옮겨 스크린리더가 변화를 놓치지 않게 한다
    wrap.querySelector<HTMLElement>('.contact-done')?.focus();
  });
}

function doneHtml(title: string, body: string, extra = ''): string {
  return `
  <div class="contact-done" role="status" aria-live="polite" tabindex="-1">
    <span class="mark"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></span>
    <h2 class="heading-ko">${title}</h2>
    <p>${body}</p>
    ${extra}
    <p style="margin-top:1.5rem"><a href="#/about" style="color:var(--st-accent-savings)">서비스 소개로 돌아가기</a></p>
  </div>`;
}
