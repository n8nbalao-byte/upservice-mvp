import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Alert, EmptyState, Loading, StatusBadge, useAction, useDialog } from './ui';

type Foto = { id: string; tipo: 'PROFISSIONAL' | 'LOJA'; width: number | null; src: string; small: string };
const TIPO = { PROFISSIONAL: 'Profissional', LOJA: 'Loja' } as const;
const PEQUENA = 1200; // abaixo disso a foto pode ficar granulada no computador

const paraDataUrl = (b: Blob) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error('Não foi possível ler a foto.')); r.readAsDataURL(b); });
const blob = (c: HTMLCanvasElement, tipo: string, q: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, tipo, q));

/** Reduz no próprio navegador: versão de computador (até 1920 px) e de celular (960 px), em WebP (JPEG se não der). */
async function reduzir(file: File) {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Não foi possível abrir esta imagem. Use JPG, PNG ou WebP.'); });
  const versao = async (max: number, mime: string) => {
    const w = Math.min(max, bmp.width);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((bmp.height * w) / bmp.width);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return blob(c, mime, mime === 'image/webp' ? 0.82 : 0.85);
  };
  let mime = 'image/webp';
  let g = await versao(1920, mime);
  if (!g || g.type !== mime) { mime = 'image/jpeg'; g = await versao(1920, mime); }
  const p = await versao(960, mime);
  if (!g || !p) throw new Error('Não foi possível preparar a foto.');
  return { big: await paraDataUrl(g), small: await paraDataUrl(p), width: bmp.width };
}

/** Configurações → Fotos da tela de login: o carrossel alterna fotos de profissional e de loja, em ordem aleatória. */
export function LoginFotosConfig() {
  const { busy, run } = useAction();
  const { confirm } = useDialog();
  const [fotos, setFotos] = useState<Foto[]>();
  const [tipo, setTipo] = useState<Foto['tipo']>('PROFISSIONAL');
  const [aviso, setAviso] = useState('');
  const load = () => api<Foto[]>('/admin/login-fotos').then(setFotos, () => setFotos([]));
  useEffect(() => { load(); }, []);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem('foto') as HTMLInputElement).files?.[0];
    if (!file) return;
    setAviso('');
    if (await run('enviar', async () => {
      const r = await reduzir(file);
      if (r.width < PEQUENA) setAviso(`Esta foto tem só ${r.width} px de largura: no computador pode ficar granulada.`);
      await api('/admin/login-fotos', { body: { tipo, ...r } });
    }, 'Foto adicionada à tela de login.')) { form.reset(); load(); }
  }

  async function apagar(f: Foto) {
    if (!(await confirm({ title: 'Apagar esta foto?', message: 'Ela sai da tela de login na hora.', confirmText: 'Apagar foto', tone: 'danger' }))) return;
    if (await run(f.id, () => api(`/admin/login-fotos/${f.id}`, { method: 'DELETE' }), 'Foto apagada.')) load();
  }

  const conta = (t: Foto['tipo']) => (fotos ?? []).filter((f) => f.tipo === t).length;
  return (
    <div className="card stack">
      <p className="muted">A tela de login alterna as fotos de <b>profissional</b> e de <b>loja</b>, em ordem diferente a cada vez. Envie fotos horizontais e de boa qualidade (de preferência com 1600 px de largura ou mais); o app reduz o tamanho sozinho.</p>
      <form className="row wrap" onSubmit={enviar} style={{ alignItems: 'flex-end' }}>
        <fieldset className="pix-types">
          <legend>A foto é de</legend>
          {(['PROFISSIONAL', 'LOJA'] as const).map((t) => (
            <label key={t} className={`pix-type${tipo === t ? ' selected' : ''}`}><input type="radio" name="tipo" checked={tipo === t} onChange={() => setTipo(t)} />{TIPO[t]}</label>
          ))}
        </fieldset>
        <label style={{ flex: '1 1 260px' }}>Foto<input name="foto" type="file" accept="image/jpeg,image/png,image/webp,image/avif" required /></label>
        <button className="primary" disabled={busy === 'enviar'}>{busy === 'enviar' ? 'Enviando…' : 'Enviar foto'}</button>
      </form>
      {aviso && <Alert kind="warning">{aviso}</Alert>}
      {!fotos ? <Loading /> : fotos.length === 0 ? <EmptyState icon="file" title="Nenhuma foto" text="Sem fotos, a tela de login mostra só o fundo azul." /> : (
        <>
          <p className="muted">{conta('PROFISSIONAL')} de profissional · {conta('LOJA')} de loja</p>
          <div className="login-fotos">
            {fotos.map((f) => (
              <figure key={f.id} className="login-foto">
                <img src={f.small} alt="" loading="lazy" />
                <figcaption>
                  <StatusBadge tone={f.tipo === 'LOJA' ? 'info' : 'accent'}>{TIPO[f.tipo]}</StatusBadge>
                  {f.width != null && f.width < PEQUENA && <span className="muted" title="Pode ficar granulada no computador">{f.width} px</span>}
                  <button type="button" className="sm ghost text-danger" disabled={busy === f.id} onClick={() => apagar(f)}>Apagar</button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
