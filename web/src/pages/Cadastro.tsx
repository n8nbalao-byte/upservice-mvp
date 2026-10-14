import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../App';
import { api, label, type Doc } from '../lib/api';
import { fileToDataUrl } from '../lib/device';

const DOCS: { type: Doc['type']; name: string }[] = [
  { type: 'CPF', name: 'CPF (foto do documento)' },
  { type: 'RG', name: 'RG (frente e verso na mesma foto ou PDF)' },
  { type: 'COMPROVANTE', name: 'Comprovante de residência' },
];

export default function Cadastro() {
  const { me, reload } = useMe();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const p = me.profile ?? {};
  const docsDone = DOCS.every((d) => me.documents.some((x) => x.type === d.type && x.status !== 'REJEITADO'));
  const step = !me.profile ? 1 : !docsDone ? 2 : !me.profile.terms_accepted_at ? 3 : 4;

  async function run(what: string, fn: () => Promise<unknown>) {
    setError('');
    setBusy(what);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    run('profile', () => api('/me/profile', { method: 'PUT', body }));
  }

  function upload(type: string, file: File | undefined) {
    if (file) run(type, async () => api('/me/documents', { body: { type, file: await fileToDataUrl(file) } }));
  }

  return (
    <div className="stack">
      <h1>Meu cadastro</h1>
      <p className="muted">Etapa {Math.min(step, 3)} de 3 {step === 4 && '· cadastro completo'}</p>
      {error && <p className="error">{error}</p>}

      <form className="card stack" onSubmit={saveProfile}>
        <h2>1. Dados pessoais</h2>
        <div className="cols">
          <label>Nome completo<input name="name" defaultValue={me.user.name} required /></label>
          <label>CPF<input name="cpf" defaultValue={p.cpf} inputMode="numeric" required readOnly={!!p.cpf} /></label>
          <label>RG<input name="rg" defaultValue={p.rg} required /></label>
          <label>Telefone (com DDD)<input name="phone" defaultValue={p.phone} inputMode="tel" required /></label>
          <label>Endereço<input name="address" defaultValue={p.address} required /></label>
          <label>Cidade<input name="city" defaultValue={p.city} required /></label>
          <label>UF<input name="uf" defaultValue={p.uf ?? 'SP'} maxLength={2} required /></label>
          <label>Contato de emergência (nome)<input name="emergencyName" defaultValue={p.emergency_name} required /></label>
          <label>Telefone de emergência<input name="emergencyPhone" defaultValue={p.emergency_phone} inputMode="tel" required /></label>
        </div>
        <button className="primary" disabled={busy === 'profile'}>{me.profile ? 'Atualizar dados' : 'Salvar e continuar'}</button>
      </form>

      {step >= 2 && (
        <div className="card stack">
          <h2>2. Documentos</h2>
          <p className="muted">Fotos nítidas ou PDF, até 5 MB. Os arquivos ficam em área privada e só a equipe autorizada da UpService pode consultá-los.</p>
          {DOCS.map((d) => {
            const current = me.documents.find((x) => x.type === d.type);
            return (
              <div key={d.type} className="row between">
                <div>
                  <b>{d.name}</b>{' '}
                  {current && <span className="badge">{label(current.status)}</span>}
                  {current?.rejection_reason && <div className="error">Motivo: {current.rejection_reason}</div>}
                </div>
                {current?.status !== 'APROVADO' && (
                  <label className="button">
                    {busy === d.type ? 'Enviando…' : current ? 'Substituir' : 'Enviar'}
                    <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => upload(d.type, e.target.files?.[0])} />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      {step >= 3 && (
        <div className="card stack">
          <h2>3. Termos e privacidade</h2>
          <ul className="muted">
            <li>Ao fazer check-in, pausa, retorno e checkout, o app registra sua <b>localização GPS</b> e uma <b>selfie</b>, junto com o horário do servidor.</li>
            <li>Esses registros servem para comprovar sua presença na loja e calcular as horas da diária.</li>
            <li>Durante a atividade, com a tela do app aberta, a localização também é conferida a cada 10 minutos. Na pausa e com a tela fechada, nada é lido. Guardamos só a última leitura e eventuais saídas do raio da loja, nunca o trajeto.</li>
            <li>Selfies e documentos são vistos apenas por gestores da loja e administradores da UpService, e todo acesso fica registrado.</li>
            <li>Os dados são mantidos por 5 anos. Você pode consultar e atualizar seus próprios dados a qualquer momento.</li>
          </ul>
          <p className="muted">
            Leia a <a href="/privacidade.html" target="_blank">Política de Privacidade</a> e os <a href="/termos.html" target="_blank">Termos de Uso</a> completos.
          </p>
          {me.profile?.terms_accepted_at ? (
            <p className="notice">Termos aceitos.</p>
          ) : (
            <button className="primary" disabled={busy === 'terms'} onClick={() => run('terms', () => api('/me/terms', { body: { accept: true } }))}>
              Li e aceito
            </button>
          )}
        </div>
      )}

      {me.complete && <button className="primary big" onClick={() => navigate('/vagas')}>Ver vagas disponíveis</button>}
    </div>
  );
}
