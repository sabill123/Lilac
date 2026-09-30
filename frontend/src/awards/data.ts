import type { AwardEdition, AwardEntry, AwardSource } from './model';
const checkedAt='2026-09-06';
const source=(id:string,label:string,url:string,kind:AwardSource['kind']='official'):AwardSource=>({id,label,url,kind,checkedAt});
const entry=(category:string,recipient:string,work='',group='주요 부문',sourceId='results',highlight=false):AwardEntry=>({category,recipient,...(work?{work}:{}),group,sourceId,highlight});

/** Editorial records, not a live awards feed. Every entry points to inspected evidence.
 * Add a new edition as data; never overwrite an earlier year's winners. */
export const AWARD_EDITIONS: readonly AwardEdition[] = [
  {
    id:'maj-2026',series:'maj',name:'MUSIC AWARDS JAPAN',shortName:'MUSIC AWARDS\nJAPAN',nativeName:'ミュージックアワードジャパン',year:2026,date:'2026-06-13',edition:'제2회',country:'jp',kind:'awards',tone:'mint',
    scope:'주요 6개 부문 수상 결과. 전체 78개 부문 명단은 공식 결과에서 확인할 수 있습니다.',
    sources:[source('results','CEIPA 공식 수상 결과','https://www.ceipa.net/newsletter/pdf/340/detail/94'),source('site','MUSIC AWARDS JAPAN','https://www.musicawardsjapan.com/')],
    entries:[
      entry('최우수 악곡상','サカナクション','怪獣','주요 부문','results',true),
      entry('최우수 아티스트상','Mrs. GREEN APPLE','','주요 부문','results',true),
      entry('최우수 뉴 아티스트상','HANA','','주요 부문','results',true),
      entry('최우수 앨범상','Fujii Kaze','Prema','주요 부문','results',true),
      entry('Best Global Hit from Japan','XG','HYPNOTIZE','주요 부문'),
      entry('최우수 아시아 악곡상','HUNTR/X','Golden','주요 부문'),
    ],
  },
  {
    id:'kma-2026',series:'kma',name:'한국대중음악상',shortName:'KOREAN MUSIC\nAWARDS',nativeName:'Korean Music Awards',year:2026,date:'2026-02-26',edition:'제23회',country:'kr',kind:'awards',tone:'amber',
    scope:'종합분야 4개 부문 선정. 장르·특별분야를 포함한 전체 수상자 명단은 공식 결과에서 확인할 수 있습니다.',
    sources:[source('results','한국대중음악상 종합분야 수상 결과','https://koreanmusicawards.com/winners/total-2026/'),source('event','제23회 한국대중음악상 안내','https://koreanmusicawards.com/kma2026/')],
    entries:[entry('올해의 음반','추다혜차지스','소수민족','종합분야','results',true),entry('올해의 노래','이찬혁','멸종위기사랑','종합분야','results',true),entry('올해의 음악인','한로로','','종합분야','results',true),entry('올해의 신인','우희준','','종합분야','results',true)],
  },
  {
    id:'golden-disc-2026',series:'golden-disc',name:'골든디스크어워즈',shortName:'GOLDEN DISC\nAWARDS',nativeName:'Golden Disc Awards',year:2026,date:'2026-01-10',edition:'제40회',country:'kr',kind:'awards',tone:'amber',
    scope:'대상 3개 부문과 신인상 2팀 선정. 전체 수상자 명단이 아니며 신인상은 매일경제 보도로 확인했습니다.',
    sources:[source('results','골든디스크 공식 수상 결과','https://www.goldendisc.co.kr/ko/winners'),source('event','제40회 골든디스크 일정','https://www.goldendisc.co.kr/en/about'),source('rookies','매일경제 신인상 수상 보도','https://www.mk.co.kr/news/musics/11929055','report')],
    entries:[entry('디지털 음원 대상','G-DRAGON','HOME SWEET HOME (feat. 태양, 대성)','대상','results',true),entry('음반 대상','Stray Kids','KARMA','대상','results',true),entry('아티스트 대상','제니','','대상','results',true),entry('신인상','ALLDAY PROJECT','','신인상','rookies'),entry('신인상','CORTIS','','신인상','rookies')],
  },
  {
    id:'kohaku-2025',series:'kohaku',name:'NHK 홍백가합전',shortName:'NHK\n紅白歌合戦',nativeName:'第76回NHK紅白歌合戦',year:2025,date:'2025-12-31',edition:'제76회',country:'jp',kind:'broadcast',tone:'red',result:'백조 우승',resultSourceId:'results',
    scope:'연말 음악방송의 팀 대결 결과와 발표·보도로 확인한 8팀의 곡목입니다. 개인 수상 명단이나 전체 출연진·방송 순서가 아닙니다.',
    sources:[
      source('results','NHK 제76회 방송 결과','https://www.nhk.or.jp/kouhaku/result76/'),
      source('hana','HANA 공식 출연·곡목 안내','https://hana.b-rave.tokyo/media/tv/251114/'),
      source('mga','Mrs. GREEN APPLE 공식 출연 안내','https://mrsgreenapple.com/news/detail/22152?lang=zh-CHS'),
      source('illit','ILLIT 일본 공식 곡목 발표','https://x.com/ILLITjpofficial/status/2001849979821068359'),
      source('andteam','&TEAM 공식 무대 안내','https://x.com/andTEAMofficial/status/2005594646152708424'),
      source('sakanaction','サカナクション 공식 곡목 발표','https://x.com/sakanaction/status/2001850474572419260'),
      source('yonezu','米津玄師 공식 공연 아카이브 안내','https://reissuerecords.net/2026/01/09/irisout_kouhaku/'),
      source('milk','M!LK 공식 곡목 발표','https://x.com/milk_info/status/2001849986510647649?lang=ja'),
      source('aespa','HuffPost Japan 발표 곡목 보도','https://www.huffingtonpost.jp/entry/story_jp_694a2425e4b0582005c4196c','report'),
    ],
    entries:[entry('공개 곡목','HANA','ROSE','출연곡','hana'),entry('공개 곡목','Mrs. GREEN APPLE','GOOD DAY','출연곡','mga'),entry('공개 곡목','ILLIT','Almond Chocolate','출연곡','illit'),entry('공개 곡목','&TEAM','FIREWORK','출연곡','andteam'),{...entry('공개 곡목','サカナクション','怪獣 · 新宝島','출연곡','sakanaction'),searchTerms:['サカナクション 怪獣','サカナクション 新宝島']},entry('공개 곡목','米津玄師','IRIS OUT','출연곡','yonezu'),entry('공개 곡목','M!LK','イイじゃん','출연곡','milk'),entry('공개 곡목','aespa','Whiplash','출연곡','aespa')],
  },
  {
    id:'record-awards-2025',series:'record-awards',name:'일본 레코드대상',shortName:'日本\nレコード大賞',nativeName:'第67回 輝く！日本レコード大賞',year:2025,date:'2025-12-30',edition:'제67회',country:'jp',kind:'awards',tone:'blue',
    scope:'주요 6개 부문의 7개 수상 기록 선정. 특별국제음악상은 두 수상자를 각각 표시했습니다. 전체 수상 명단은 공식 결과에서 확인할 수 있습니다.',
    sources:[source('results','일본작곡가협회 제67회 수상 결과','https://www.jacompa.or.jp/record/67.php'),source('broadcast','TBS 일본 레코드대상','https://www.tbs.co.jp/recordaward/')],
    entries:[entry('일본 레코드대상','Mrs. GREEN APPLE','ダーリン','대상','results',true),entry('최우수 신인상','HANA','','신인상','results',true),entry('최우수 가창상','山内惠介','','주요 부문'),entry('특별 앨범상','藤井 風','Prema','특별상'),entry('특별국제음악상','Ado','','특별상'),entry('특별국제음악상','&TEAM','','특별상'),{...entry('작곡상','工藤大輝 · 花村想太','ノンフィクションズ / Da-iCE','제작자상'),searchTerms:['Da-iCE ノンフィクションズ']}],
  },
  {
    id:'mma-2025',series:'mma',name:'멜론뮤직어워드',shortName:'MELON MUSIC\nAWARDS',nativeName:'MMA',year:2025,date:'2025-12-20',edition:'제17회',country:'kr',kind:'awards',tone:'mint',
    scope:'대상 4개 부문과 올해의 신인 2팀 선정. 전체 수상자 명단은 공식 결과에서 확인할 수 있습니다.',
    sources:[source('results','멜론 MMA 2025 공식 수상 결과','https://event.melon.com/mma/result.htm?mmaYear=2025'),source('event','MMA 2025 공식 행사 안내','https://event.melon.com/mma/home.htm')],
    entries:[entry('올해의 앨범','G-DRAGON','Übermensch','대상','results',true),entry('올해의 아티스트','G-DRAGON','','대상','results',true),entry('올해의 베스트송','G-DRAGON','HOME SWEET HOME (feat. 태양, 대성)','대상','results',true),entry('올해의 레코드','제니 (JENNIE)','like JENNIE','대상','results',true),entry('올해의 신인','ALLDAY PROJECT','','신인상'),entry('올해의 신인','Hearts2Hearts (하츠투하츠)','','신인상')],
  },
  {
    id:'mama-2025',series:'mama',name:'MAMA AWARDS',shortName:'MAMA\nAWARDS',year:2025,date:'2025-11-28',endDate:'2025-11-29',country:'kr',kind:'awards',tone:'rose',
    scope:'대상 4개를 포함한 주요 12개 부문 선정. 홍콩에서 열린 2025년 행사의 결과이며, 공동 수상·협업 크레딧은 함께 표시했습니다.',
    sources:[source('results','CJ ENM 2025 MAMA AWARDS 공식 결과','https://www.cjenm.com/en/news/2025-mama-awards-demonstrates-musics-power-to-heal-and-unite-in-moving-two-nights-performances/')],
    entries:[entry('올해의 아티스트','G-DRAGON','','대상','results',true),entry('올해의 앨범','Stray Kids','KARMA','대상','results',true),entry('올해의 노래','ROSÉ · Bruno Mars','APT.','대상','results',true),entry('올해의 팬스 초이스','ENHYPEN','','대상','results',true),entry('베스트 남자 그룹','SEVENTEEN'),entry('베스트 여자 그룹','aespa'),entry('베스트 남자 아티스트','G-DRAGON'),entry('베스트 여자 아티스트','ROSÉ'),{...entry('베스트 뉴 아티스트','CORTIS · Hearts2Hearts','','신인상'),searchTerms:['CORTIS','Hearts2Hearts']},entry('베스트 컬래버레이션','ROSÉ · Bruno Mars','APT.'),entry('베스트 댄스 퍼포먼스 남자 솔로','G-DRAGON','TOO BAD (feat. Anderson .Paak)'),entry('베스트 댄스 퍼포먼스 여자 솔로','JENNIE','like JENNIE')],
  },
];
