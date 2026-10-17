// Explorador UP Service: personagem do mapa (desenho próprio, em SVG). A origem (0, 0) fica entre os pés.
// Estados: parado (respira), andando (pernas e braços alternam) e comemorando (pula com estrelinhas).
export type Pose = 'parado' | 'andando' | 'comemorando';

export function Explorador({ x, y, pose, flip = false }: { x: number; y: number; pose: Pose; flip?: boolean }) {
  return (
    <g className={`g-explorador ${pose}`} transform={`translate(${x} ${y})`} aria-hidden="true">
      <ellipse className="sombra" cx="0" cy="0" rx="16" ry="4.5" fill="rgba(40,25,5,0.28)" />
      <g className="corpo" transform={flip ? 'scale(-1 1)' : undefined}>
        {/* Pernas */}
        <g className="perna perna-a"><rect x="-8" y="-20" width="7" height="18" rx="3" fill="#1d3a6b" /><ellipse cx="-4.5" cy="-1.5" rx="5.5" ry="3" fill="#4a2a0c" /></g>
        <g className="perna perna-b"><rect x="1" y="-20" width="7" height="18" rx="3" fill="#1d3a6b" /><ellipse cx="4.5" cy="-1.5" rx="5.5" ry="3" fill="#4a2a0c" /></g>
        {/* Mochila dourada (atrás) */}
        <rect x="-17" y="-40" width="11" height="19" rx="4" fill="#e9a812" stroke="#a86f00" strokeWidth="1.5" />
        <rect x="-15.5" y="-33" width="8" height="4" rx="1.5" fill="#ffd45c" />
        {/* Corpo: camiseta azul-marinho com faixa dourada */}
        <path d="M-10 -40 Q0 -45 10 -40 L11 -19 Q0 -16 -11 -19 Z" fill="#23427a" stroke="#14284b" strokeWidth="1.5" />
        <path d="M-10.5 -30 L10.5 -30" stroke="#ffc21a" strokeWidth="2.5" />
        {/* Braços */}
        <g className="braco braco-a"><rect x="-14" y="-39" width="6" height="15" rx="3" fill="#23427a" /><circle cx="-11" cy="-23" r="3.3" fill="#f2c39b" /></g>
        <g className="braco braco-b"><rect x="8" y="-39" width="6" height="15" rx="3" fill="#23427a" /><circle cx="11" cy="-23" r="3.3" fill="#f2c39b" /></g>
        {/* Cabeça */}
        <circle cx="0" cy="-52" r="11" fill="#f6cfa8" stroke="#c98f62" strokeWidth="1.2" />
        <circle cx="3.8" cy="-52" r="1.6" fill="#2a1a0a" />
        <circle cx="-3" cy="-52" r="1.6" fill="#2a1a0a" />
        <path d="M-2.5 -47 Q1 -44.5 4.5 -47" fill="none" stroke="#8a4a20" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="-48.5" r="2.2" fill="#f4a08a" opacity="0.6" />
        {/* Boné azul-marinho com aba e botão dourados */}
        <path d="M-11.5 -55 Q-11 -66 0 -66 Q11 -66 11.5 -55 Z" fill="#1d3a6b" stroke="#14284b" strokeWidth="1.2" />
        <path d="M2 -56 Q14 -58 19 -54 Q12 -52.5 2 -53.5 Z" fill="#ffc21a" stroke="#a86f00" strokeWidth="1" />
        <circle cx="0" cy="-66" r="2" fill="#ffc21a" />
        <circle cx="-4" cy="-61" r="2.4" fill="#ffc21a" />
      </g>
      {pose === 'comemorando' && (
        <g className="brilhos">
          {[[-22, -62], [22, -66], [0, -84]].map(([sx, sy], i) => <path key={i} transform={`translate(${sx} ${sy})`} d="M0 -6 L1.8 -1.8 6 0 1.8 1.8 0 6 -1.8 1.8 -6 0 -1.8 -1.8Z" fill="#ffd84d" />)}
        </g>
      )}
    </g>
  );
}
