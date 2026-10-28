// 숲속 오두막: 지붕·벽은 currentColor, 창문 불빛과 굴뚝 연기는 CSS로 움직인다.
export default function CabinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <g className="cabin-smoke" fill="currentColor">
        <circle cx="45" cy="9" r="2.5" />
        <circle cx="48" cy="4" r="2" />
      </g>
      <rect x="41" y="12" width="6" height="12" fill="currentColor" />
      <path d="M6 33 32 12l26 21h-6v23H12V33z" fill="currentColor" />
      <rect className="cabin-window" x="19" y="37" width="10" height="9" rx="1" />
      <rect x="36" y="38" width="10" height="18" rx="1" className="cabin-door" />
    </svg>
  )
}
