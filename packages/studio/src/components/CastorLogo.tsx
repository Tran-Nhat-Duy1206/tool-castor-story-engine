// Castor 品牌 logo（与 README 顶部 assets/logo.svg 同款）：深色圆底 + 橙色墨滴 + 羽毛笔尖。
// 内联为组件，避免 Vite 静态资源/类型声明依赖。渐变 id 加 castor- 前缀防全局冲突。
export function CastorLogo({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" className={className} role="img" aria-label="Castor">
      <defs>
        <linearGradient id="castor-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2d1b0e" />
          <stop offset="100%" stopColor="#1a1008" />
        </linearGradient>
        <linearGradient id="castor-drop" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f4a261" />
          <stop offset="100%" stopColor="#e76f51" />
        </linearGradient>
        <linearGradient id="castor-nib" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fefae0" />
          <stop offset="100%" stopColor="#dda15e" />
        </linearGradient>
        <filter id="castor-glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle cx="256" cy="256" r="240" fill="url(#castor-bg)" stroke="#f4a261" strokeWidth="2.5" opacity="0.95" />
      <circle cx="256" cy="256" r="210" fill="none" stroke="#dda15e" strokeWidth="1" strokeDasharray="8 8" opacity="0.25" />

      <path
        d="M256 120 C256 120, 340 230, 340 305 C340 352, 302 392, 256 392 C210 392, 172 352, 172 305 C172 230, 256 120, 256 120Z"
        fill="url(#castor-drop)"
        filter="url(#castor-glow)"
        opacity="0.9"
      />
      <path d="M256 180 L240 315 L256 345 L272 315 Z" fill="url(#castor-nib)" opacity="0.85" />
      <line x1="256" y1="215" x2="256" y2="335" stroke="#2d1b0e" strokeWidth="1.5" opacity="0.4" />

      <circle cx="190" cy="240" r="3" fill="#f4a261" opacity="0.5" />
      <circle cx="322" cy="240" r="3" fill="#f4a261" opacity="0.5" />
      <circle cx="170" cy="325" r="3" fill="#e9c46a" opacity="0.4" />
      <circle cx="342" cy="325" r="3" fill="#e9c46a" opacity="0.4" />
    </svg>
  );
}
