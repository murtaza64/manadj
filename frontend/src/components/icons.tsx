// Central location for all SVG icons used in the app

interface IconProps {
  width?: number;
  height?: number;
  opacity?: number;
  className?: string;
}

export const MusicIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M14 2v9c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.4 0 .7.1 1 .3V4H7v7c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.4 0 .7.1 1 .3V2h8z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const PersonIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 1a3 3 0 0 0-3 3v2a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zm0 8c-2.2 0-4 1.8-4 4h1c0-1.7 1.3-3 3-3s3 1.3 3 3h1c0-2.2-1.8-4-4-4z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const KeyIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M11 1a4 4 0 0 0-3.8 5.2L1 12.4V15h2.6l6.2-6.2A4 4 0 1 0 11 1zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const SpeedIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 1a7 7 0 0 0-7 7h1a6 6 0 1 1 6 6v-1a5 5 0 1 0 0-10v1l3-2-3-2v1z M8 6v3l2.5 1.5-.8 1.3L6 10V6h2z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const EnergyIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M9 1L4 9h4l-1 6 5-8H8l1-6z" fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const TagIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M1 1v6l7 7 6-6-7-7H1zm3 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const NeedleIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 512 512" fill="none" className={className}>
    <path d="M319.213,27.648C302.616,10.078,279.533,0,255.879,0c-46.199,0-85.231,39.074-85.197,86.084l12.1,136.823
      c3.251,56.943,13.32,113.468,29.926,168.03l35.115,115.021c1.092,3.593,4.412,6.042,8.158,6.042h0.009
      c3.763,0,7.066-2.458,8.158-6.059l34.901-115.012c16.606-54.554,26.667-111.078,29.901-167.748L341.195,85.7
      C342.407,64.563,334.599,43.947,319.213,27.648z M231.414,280.149c-0.384,0.051-0.768,0.077-1.143,0.077
      c-4.207,0-7.876-3.106-8.457-7.398c-2.295-17.118-3.959-34.577-4.958-51.866l-12.22-137.387c-0.418-4.702,3.046-8.841,7.74-9.259
      c4.838-0.478,8.849,3.063,9.259,7.74l12.245,137.651c0.981,17.135,2.611,34.15,4.855,50.85
      C239.358,275.226,236.082,279.526,231.414,280.149z M255.981,418.133c-4.71,0-8.533-3.814-8.533-8.533s3.823-8.533,8.533-8.533
      c4.719,0,8.533,3.814,8.533,8.533S260.7,418.133,255.981,418.133z M264.515,196.267c0,4.719-3.814,8.533-8.533,8.533
      c-4.71,0-8.533-3.814-8.533-8.533V51.2c0-4.719,3.823-8.533,8.533-8.533c4.719,0,8.533,3.814,8.533,8.533V196.267z M307.13,83.575
      l-12.254,137.651c-0.956,16.887-2.628,34.33-4.932,51.601c-0.58,4.284-4.241,7.398-8.448,7.398c-0.375,0-0.759-0.026-1.143-0.077
      c-4.668-0.623-7.953-4.915-7.33-9.591c2.253-16.828,3.883-33.852,4.838-50.577l12.262-137.924c0.418-4.676,4.48-8.226,9.259-7.74
      C304.075,74.735,307.54,78.874,307.13,83.575z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const SearchIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2zm0 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm4.5 7.5l3 3-1 1-3-3 1-1z"
          fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const BeatgridIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    {/* Four vertical bars with the first slightly bolder */}
    <rect x="2" y="2" width="1.5" height="12" fill="var(--text)" opacity={opacity}/>
    <rect x="6" y="2" width="1" height="12" fill="var(--text)" opacity={opacity}/>
    <rect x="10" y="2" width="1" height="12" fill="var(--text)" opacity={opacity}/>
    <rect x="14" y="2" width="1" height="12" fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const SettingsIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="var(--text)" opacity={opacity}/>
    <path d="M14 7h-1.5a4.5 4.5 0 0 0-.5-1.2l1.1-1.1-.7-.7-1.1 1.1A4.5 4.5 0 0 0 10 4.5V3H9v1.5a4.5 4.5 0 0 0-1.3.6L6.6 4 6 4.7l1.1 1.1A4.5 4.5 0 0 0 6.5 7H5v1h1.5c.1.4.3.8.5 1.2L6 10.3l.7.7 1.1-1.1c.4.2.8.4 1.2.5V12h1v-1.5c.4-.1.8-.3 1.2-.5l1.1 1.1.7-.7-1.1-1.1c.2-.4.4-.8.5-1.2H14V7z" fill="var(--text)" opacity={opacity}/>
  </svg>
);

export const ArrowDownIcon = ({ width = 16, height = 16, opacity = 0.7, className }: IconProps) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" className={className}>
    <path d="M8 1v12M8 13l-4-4M8 13l4-4"
          stroke="var(--text)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={opacity}/>
  </svg>
);
