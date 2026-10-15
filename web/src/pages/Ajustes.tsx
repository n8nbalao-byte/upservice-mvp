import { useState } from 'react';
import { Icon } from '../components/icons';
import { Alert, PageHeader } from '../components/ui';
import { SOUND_TONES, getSoundPrefs, playTone, setSoundPrefs, type SoundPrefs } from '../lib/device';

/** Ajustes do painel. O som vale para este navegador: cada computador ou celular tem o seu. */
export default function Ajustes() {
  const [prefs, setPrefs] = useState(getSoundPrefs);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const save = (change: Partial<SoundPrefs>) => { const next = { ...prefs, ...change }; setPrefs(next); setSoundPrefs(next); return next; };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHeader title="Ajustes" description="Como o painel avisa você sobre novas pendências." />

      <section className="card stack">
        <div className="row between">
          <div>
            <h2>Som das notificações</h2>
            <p className="muted">Toca quando chega uma nova pendência. Vale só para este navegador.</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={prefs.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
            <span>{prefs.enabled ? 'Ligado' : 'Desligado'}</span>
          </label>
        </div>

        <fieldset className="tones" disabled={!prefs.enabled}>
          <legend>Modelo de som</legend>
          {SOUND_TONES.map((t) => (
            <label key={t.key} className={`tone${prefs.tone === t.key ? ' selected' : ''}`}>
              <input type="radio" name="tone" checked={prefs.tone === t.key} onChange={() => playTone(save({ tone: t.key }).tone, prefs.volume)} />
              <span><b>{t.name}</b><small>{t.hint}</small></span>
              <button type="button" className="sm ghost" onClick={() => playTone(t.key, prefs.volume)} aria-label={`Ouvir ${t.name}`}><Icon name="bell" size={16} />Ouvir</button>
            </label>
          ))}
        </fieldset>

        <label>Volume do som: {prefs.volume}%
          <input type="range" min={0} max={100} step={5} value={prefs.volume} disabled={!prefs.enabled}
            onChange={(e) => save({ volume: Number(e.target.value) })} onPointerUp={() => playTone(prefs.tone, prefs.volume)} onKeyUp={() => playTone(prefs.tone, prefs.volume)} />
          <span className="hint">Independente do volume do computador: 100% é o máximo deste app.</span>
        </label>
      </section>

      <section className="card stack">
        <h2>Notificações do navegador</h2>
        <p className="muted">Mostram um aviso mesmo com o UpService em outra aba ou minimizado.</p>
        {permission === 'granted' && <Alert kind="success">Ativadas neste navegador.</Alert>}
        {permission === 'default' && <div><button className="primary" onClick={() => Notification.requestPermission().then(setPermission)}>Ativar notificações</button></div>}
        {permission === 'denied' && <Alert kind="warning">Bloqueadas neste navegador. Para ativar, libere as notificações do site nas configurações do navegador (ícone de cadeado ao lado do endereço).</Alert>}
      </section>
    </div>
  );
}
