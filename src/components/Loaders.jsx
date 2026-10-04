// 골프와 나 로딩 모션: 코드로 그린 SVG + CSS라 이미지 파일이 없다.
// - PuttLoader: 전체 화면처럼 길게 기다릴 때(공이 직선으로 굴러 홀컵에 쏙, 깃발이 펄럭임)
// - BounceBall: 버튼 안의 짧은 대기(미니멀 공이 통통)
// 둘 다 0.3초가 지나야 나타나고(짧은 대기에서는 깜빡이지 않음), '동작 줄이기' 설정이면 멈춘 그림으로 보인다.

const BALL_DIMPLES = '<g transform="translate(43.5,16.2) rotate(-101)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(56.5,16.2) rotate(-79)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(24.0,27.5) rotate(-139)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(37.0,27.5) rotate(-120)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(50.0,27.5) rotate(-90)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(63.0,27.5) rotate(-60)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(76.0,27.5) rotate(-41)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(17.5,38.7) rotate(-161)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(30.5,38.7) rotate(-150)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(43.5,38.7) rotate(-120)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(56.5,38.7) rotate(-60)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(69.5,38.7) rotate(-30)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(82.5,38.7) rotate(-19)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(24.0,50.0) rotate(180)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(37.0,50.0) rotate(180)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(50.0,50.0) rotate(0)"><ellipse rx="5.20" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.82" cy="1.04" rx="3.22" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(63.0,50.0) rotate(0)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(76.0,50.0) rotate(0)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(17.5,61.3) rotate(161)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(30.5,61.3) rotate(150)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(43.5,61.3) rotate(120)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(56.5,61.3) rotate(60)"><ellipse rx="4.92" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.72" cy="1.04" rx="3.05" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(69.5,61.3) rotate(30)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(82.5,61.3) rotate(19)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(24.0,72.5) rotate(139)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(37.0,72.5) rotate(120)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(50.0,72.5) rotate(90)"><ellipse rx="4.30" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.50" cy="1.04" rx="2.66" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(63.0,72.5) rotate(60)"><ellipse rx="3.95" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="1.38" cy="1.04" rx="2.45" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(76.0,72.5) rotate(41)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(43.5,83.8) rotate(101)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g><g transform="translate(56.5,83.8) rotate(79)"><ellipse rx="2.65" ry="5.2" fill="rgba(52,64,59,0.1)"/><ellipse cx="0.93" cy="1.04" rx="1.65" ry="3.22" fill="rgba(255,255,255,0.55)"/></g>'

function MinimalBall({ x, y, size }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="gm-ball-g" cx="36%" cy="30%" r="82%">
          <stop offset="0" stopColor="#ffffff" /><stop offset=".45" stopColor="#f4f6f5" />
          <stop offset=".8" stopColor="#d9dfdc" /><stop offset="1" stopColor="#b4bdb9" />
        </radialGradient>
        <radialGradient id="gm-ball-s" cx="38%" cy="32%" r="78%">
          <stop offset=".55" stopColor="#1c2924" stopOpacity="0" /><stop offset="1" stopColor="#1c2924" stopOpacity=".3" />
        </radialGradient>
        <radialGradient id="gm-ball-h" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".95" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id="gm-ball-c"><circle cx="50" cy="50" r="40" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="40" fill="url(#gm-ball-g)" />
      <g clipPath="url(#gm-ball-c)" dangerouslySetInnerHTML={{ __html: BALL_DIMPLES }} />
      <circle cx="50" cy="50" r="40" fill="url(#gm-ball-s)" />
      <ellipse cx="36" cy="30" rx="13" ry="8" fill="url(#gm-ball-h)" transform="rotate(-28 36 30)" />
      <circle cx="50" cy="50" r="39.6" fill="none" stroke="rgba(120,134,128,.45)" strokeWidth=".8" />
    </svg>
  )
}

export function PuttLoader({ label = '불러오는 중이에요' }) {
  return (
    <div className="gm-loader gm-putt" role="status">
      <svg width="200" height="120" viewBox="0 0 150 90" aria-hidden="true">
        <ellipse cx="75" cy="68" rx="70" ry="13" fill="#d1fae5" />
        <ellipse cx="112" cy="65" rx="10.5" ry="4.2" fill="#0f1a16" />
        <ellipse cx="112" cy="64.2" rx="10.5" ry="3.8" fill="none" stroke="#a7d9c3" strokeWidth="1.1" />
        <ellipse className="gm-putt-ripple" cx="112" cy="65" rx="10.5" ry="4.2" fill="none" stroke="#059669" strokeWidth="1.2" />
        <line x1="112" y1="64" x2="112" y2="22" stroke="#6b7280" strokeWidth="1.6" strokeLinecap="round" />
        <path className="gm-putt-flag" d="M112 22 L134 29 L112 36 Z" fill="#059669" />
        <clipPath id="gm-putt-clip"><rect x="0" y="0" width="150" height="65" /></clipPath>
        <g clipPath="url(#gm-putt-clip)">
          <g className="gm-putt-roll"><circle cx="22" cy="59" r="5.6" fill="#ffffff" stroke="#8d9b95" strokeWidth="1.3" /></g>
        </g>
      </svg>
      {label && <p className="gm-loader-label">{label}</p>}
    </div>
  )
}

export function BounceBall({ size = 16 }) {
  // size = 공 지름(px). 그림자·튀는 높이는 레이아웃을 건드리지 않게 바깥으로 넘치도록 둔다.
  const width = (size * 22) / 18
  const height = (size * 35) / 18
  return (
    <span className="gm-bounce" aria-hidden="true" style={{ width, height: size }}>
      <svg width={width} height={height} viewBox="9 3 22 35" style={{ bottom: -(size * 6) / 18 }}>
        <ellipse className="gm-bounce-shadow" cx="20" cy="35.5" rx="9" ry="2" fill="#253044" />
        <g className="gm-bounce-ball"><MinimalBall x={11} y={14} size={18} /></g>
      </svg>
    </span>
  )
}

// 개발 서버에서만 쓰는 확인용 화면: /?loader=putt 또는 /?loader=bounce
export function LoaderGallery({ view }) {
  return (
    <main className="app-shell auth-shell">
      {view === 'bounce'
        ? <p style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}><button className="primary" type="button" style={{ width: 'auto' }}><BounceBall /> 보내는 중…</button></p>
        : <PuttLoader />}
    </main>
  )
}
