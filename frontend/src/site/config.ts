/* ============================================================
   사이트 상수 — 원본 src/config/brand 와 lib/seo 에 해당.

   ⚠️ 사업자 정보는 실제 값이 없으므로 전부 플레이스홀더다.
   법인 설립·사업자등록 후 이 파일 한 곳만 고치면 약관·처리방침·
   푸터가 함께 갱신된다(원본도 같은 구조).
   ============================================================ */

export const brand = {
  site: {
    name: 'Lilac',
    tagline: '한국과 일본의 팬덤을 한 곳에서',
    description:
      '한국의 J-POP 팬과 일본의 K-POP 팬을 위한 공연·팬클럽·음반 정보와 아티스트 갤러리. 예매와 결제는 각 공식 사이트에서 합니다.',
    copyrightHolder: 'Lilac',
    domain: 'lilac.example',
  },
  company: {
    /** TODO: 법인 설립 후 실제 상호로 교체 */
    legalName: 'Lilac (개인 프로젝트)',
    ceo: '한재석',
    bizNo: '미등록',
    address: '대한민국 서울',
    supportEmail: 'support@lilac.example',
    privacyOfficer: '한재석',
  },
  legal: {
    effectiveDate: '2026년 3월 1일',
    updatedDate: '2026년 3월 1일',
  },
} as const;

/* 라우트 테이블은 코드 스플리팅 경계인 ./routes 로 옮겼다.
   (config 를 임포트하면 브랜드 상수까지 딸려오므로 main.ts 는 routes 만 본다) */
export { SITE_ROUTES, SITE_TITLES, type SiteRoute } from './routes';
