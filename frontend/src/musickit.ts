// MusicKit JS 연동 스캐폴드
// 실서비스 전환 시:
// 1) Apple Developer Program에서 미디어 식별자 + 프라이빗 키 발급
// 2) 서버에서 개발자 토큰(JWT, ES256 서명) 발급 엔드포인트 구현
// 3) 아래 DEVELOPER_TOKEN_ENDPOINT를 채우면 자동 활성화
//    → 애플뮤직 구독자는 Apple ID 1회 인증 후 "라일락 안에서" 풀트랙 재생 가능

const DEVELOPER_TOKEN_ENDPOINT = ''; // 예: '/api/musickit/token'

declare global {
  interface Window { MusicKit?: any }
}

export async function initMusicKitIfConfigured(): Promise<any | null> {
  if (!DEVELOPER_TOKEN_ENDPOINT) return null; // 데모 모드
  try {
    if (!window.MusicKit) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('musickit load failed'));
        document.head.appendChild(s);
      });
    }
    const { token } = await fetch(DEVELOPER_TOKEN_ENDPOINT).then((r) => r.json());
    await window.MusicKit.configure({
      developerToken: token,
      app: { name: 'Lilac', build: '0.1.0' },
    });
    const music = window.MusicKit.getInstance();
    await music.authorize(); // Apple ID 로그인 (Music User Token)
    return music;
  } catch (e) {
    console.warn('[musickit] init failed → 데모 모드로 폴백', e);
    return null;
  }
}
