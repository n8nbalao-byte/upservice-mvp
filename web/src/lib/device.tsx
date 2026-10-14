// Câmera, GPS e alertas do navegador.
import { useEffect, useRef, useState } from 'react';

/** Erro de GPS com o motivo usado no pedido de exceção. */
export class GeoError extends Error {
  constructor(public reason: 'GPS_INDISPONIVEL' | 'PERMISSAO_NEGADA', message: string) {
    super(message);
  }
}

export function getPosition(): Promise<GeolocationPosition> {
  return new Promise((ok, err) => {
    if (!navigator.geolocation) return err(new GeoError('GPS_INDISPONIVEL', 'Este navegador não oferece localização.'));
    navigator.geolocation.getCurrentPosition(ok, (e) => {
      err(new GeoError(e.code === e.PERMISSION_DENIED ? 'PERMISSAO_NEGADA' : 'GPS_INDISPONIVEL',
        e.code === e.PERMISSION_DENIED ? 'Permita o acesso à localização nas configurações do navegador.'
          : e.code === e.TIMEOUT ? 'O GPS demorou para responder. Vá para uma área aberta e tente de novo.'
            : 'Localização indisponível. Ative a Localização/GPS do aparelho (no celular, na barra de atalhos; no Windows, em Configurações → Privacidade → Localização) e tente de novo.',
      ));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
}

const rad = (d: number) => (d * Math.PI) / 180;
/** Mesma fórmula do servidor; aqui só para avisar antes. Quem decide é o servidor. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** Selfie ao vivo pela câmera frontal (sem galeria). Devolve JPEG em data URL. */
export function Selfie({ onCapture, onCancel }: { onCapture: (dataUrl: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stopped = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        video.current!.srcObject = s;
      })
      .catch(() => setError('Não foi possível abrir a câmera. Permita o acesso à câmera no navegador.'));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function capture() {
    const v = video.current!;
    const scale = Math.min(1, 720 / v.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL('image/jpeg', 0.7));
  }

  return (
    <div className="selfie">
      {error ? <p className="error">{error}</p> : <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} />}
      <div className="row">
        <button className="primary" disabled={!ready} onClick={capture}>Tirar selfie</button>
        <button onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** Reduz fotos de documentos para caber no limite de 5 MB. PDFs seguem como estão. */
export async function fileToDataUrl(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }
  return new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => ok(r.result as string);
    r.onerror = err;
    r.readAsDataURL(file);
  });
}

// ---------- Som das notificações do painel (preferência deste navegador) ----------

export type SoundTone = 'suave' | 'sino' | 'duplo' | 'classico';
export type SoundPrefs = { enabled: boolean; tone: SoundTone; volume: number };
export const SOUND_TONES: { key: SoundTone; name: string; hint: string }[] = [
  { key: 'suave', name: 'Suave', hint: 'Um toque curto e baixo' },
  { key: 'sino', name: 'Sino', hint: 'Toque de sino que some devagar' },
  { key: 'duplo', name: 'Duplo', hint: 'Dois toques rápidos, subindo' },
  { key: 'classico', name: 'Bipe clássico', hint: 'O bipe agudo de antes' },
];
const SOUND_KEY = 'notify-sound';
const SOUND_DEFAULT: SoundPrefs = { enabled: true, tone: 'suave', volume: 40 };

export function getSoundPrefs(): SoundPrefs {
  try { return { ...SOUND_DEFAULT, ...JSON.parse(localStorage.getItem(SOUND_KEY) ?? '{}') }; } catch { return SOUND_DEFAULT; }
}
export function setSoundPrefs(p: SoundPrefs) {
  try { localStorage.setItem(SOUND_KEY, JSON.stringify(p)); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

/** Notas de cada modelo: [frequência Hz, início s, duração s, forma da onda]. */
const NOTES: Record<SoundTone, [number, number, number, OscillatorType][]> = {
  suave: [[660, 0, 0.35, 'sine']],
  sino: [[880, 0, 1.2, 'sine'], [1760, 0, 0.6, 'sine'], [2640, 0, 0.3, 'sine']],
  duplo: [[740, 0, 0.16, 'triangle'], [988, 0.2, 0.22, 'triangle']],
  classico: [[880, 0, 0.5, 'square']],
};

/** Toca o modelo escolhido no volume próprio do app (ganho do WebAudio), sem mexer no volume do sistema. */
export function playTone(tone: SoundTone, volume: number) {
  try {
    const ctx = new AudioContext();
    const peak = Math.max(0, Math.min(1, volume / 100)) * (tone === 'classico' ? 0.15 : 0.5);
    let end = 0;
    for (const [freq, at, dur, type] of NOTES[tone]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
      end = Math.max(end, at + dur);
    }
    setTimeout(() => ctx.close(), (end + 0.3) * 1000);
  } catch { /* sem áudio: segue o alerta visual */ }
}

/** Nova pendência no painel: som conforme os ajustes (pode estar desligado) + vibração. */
export function beep() {
  const p = getSoundPrefs();
  if (p.enabled && p.volume > 0) playTone(p.tone, p.volume);
  navigator.vibrate?.([200, 100, 200]);
}

export function alertBreakOver() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 800);
  } catch { /* sem áudio: segue o alerta visual */ }
  navigator.vibrate?.([300, 100, 300]);
  if ('Notification' in window && Notification.permission === 'granted') new Notification('UpService', { body: 'Sua pausa terminou. Registre o retorno.' });
}
