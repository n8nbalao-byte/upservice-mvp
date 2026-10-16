import { minutesLeft, type Jornada } from '../lib/jornada';

function Bar({ label: text, pct, note, tone }: { label: string; pct: number; note: string; tone?: string }) {
  return (
    <div className={`jbar${tone ? ` tone-${tone}` : ''}`}>
      <div className="jbar-head"><span>{text}</span><b>{pct}%</b></div>
      <div className="jbar-track" role="progressbar" aria-label={text} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <small>{note}</small>
    </div>
  );
}

/** Barras da jornada (dia inteiro e trecho até a pausa / da pausa), usadas em Minhas diárias e na tela da atividade. */
export function JornadaBars({ j }: { j: Jornada }) {
  return (
    <>
      <Bar label="Jornada" pct={j.total} note={j.clock && j.clock.ms > 0 ? `faltam ${minutesLeft(j.clock.ms)}` : 'concluída'} />
      {j.part && (
        <Bar
          label={j.part.label}
          pct={j.part.pct}
          tone={j.phase === 'pausa' ? 'warning' : j.part.ready ? 'success' : undefined}
          note={j.part.ready ? 'Você já pode fazer sua pausa' : j.part.msLeft >= 0 ? `faltam ${minutesLeft(j.part.msLeft)}` : 'tempo encerrado'}
        />
      )}
    </>
  );
}
