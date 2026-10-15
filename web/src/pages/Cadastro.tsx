import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../App';
import { Icon } from '../components/icons';
import { Alert, PageHeader, StatusBadge, useDialog } from '../components/ui';
import { api, type Doc } from '../lib/api';
import { Selfie, fileToDataUrl } from '../lib/device';

const DOCS: { type: Doc['type']; name: string; hint: string }[] = [
  { type: 'SELFIE', name: 'Selfie', hint: 'Foto do seu rosto, de frente, em lugar claro, sem óculos escuros nem boné. Tirada na hora pela câmera.' },
  { type: 'CPF', name: 'CPF', hint: 'Foto nítida do documento' },
  { type: 'RG', name: 'RG', hint: 'Frente e verso na mesma foto ou PDF' },
  { type: 'COMPROVANTE', name: 'Comprovante de residência', hint: 'Conta de consumo ou similar, recente' },
];
const STEPS = ['Dados pessoais', 'Selfie e documentos', 'Termos'];

export default function Cadastro() {
  const { me, reload } = useMe();
  const { toast } = useDialog();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [camera, setCamera] = useState(false);
  const p = me.profile ?? {};
  const docsDone = DOCS.every((d) => me.documents.some((x) => x.type === d.type && x.status !== 'REJEITADO'));
  const step = !me.profile ? 1 : !docsDone ? 2 : !me.profile.terms_accepted_at ? 3 : 4;

  async function run(what: string, fn: () => Promise<unknown>, done: string) {
    setError('');
    setBusy(what);
    try {
      await fn();
      await reload();
      toast(done);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run('profile', () => api('/me/profile', { method: 'PUT', body: Object.fromEntries(new FormData(e.currentTarget)) }), 'Dados salvos.');
  }

  function sendSelfie(file: string) {
    setCamera(false);
    run('SELFIE', () => api('/me/documents', { body: { type: 'SELFIE', file } }), 'Selfie enviada.');
  }

  function upload(type: string, file: File | undefined) {
    if (file) run(type, async () => api('/me/documents', { body: { type, file: await fileToDataUrl(file) } }), 'Documento enviado.');
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title="Meu cadastro" description={step === 4 ? 'Cadastro completo. Você pode atualizar seus dados quando quiser.' : `Etapa ${step} de 3: complete para se candidatar às vagas.`} />
      <div className="steps" aria-label="Etapas do cadastro">
        {STEPS.map((t, i) => <span key={t} className={`step${step > i + 1 ? ' done' : ''}${step === i + 1 ? ' current' : ''}`}>{i + 1}. {t}</span>)}
      </div>
      {error && <Alert kind="danger">{error}</Alert>}

      <form className="card form" onSubmit={saveProfile}>
        <h2>1. Dados pessoais</h2>
        <div className="cols">
          <label>Nome completo<input name="name" defaultValue={me.user.name} required autoComplete="name" /></label>
          <label>CPF<input name="cpf" defaultValue={p.cpf} inputMode="numeric" required readOnly={!!p.cpf} placeholder="000.000.000-00" />{p.cpf && <span className="hint">O CPF não pode ser alterado</span>}</label>
          <label>RG<input name="rg" defaultValue={p.rg} required /></label>
          <label>Telefone (com DDD)<input name="phone" defaultValue={p.phone} inputMode="tel" required autoComplete="tel" placeholder="(11) 90000-0000" /></label>
        </div>
        <div className="cols">
          <label>Endereço<input name="address" defaultValue={p.address} required autoComplete="street-address" placeholder="Rua, número, complemento" /></label>
          <label>Cidade<input name="city" defaultValue={p.city} required /></label>
          <label>UF<input name="uf" defaultValue={p.uf ?? 'SP'} maxLength={2} required /></label>
        </div>
        <div className="cols">
          <label>Contato de emergência (nome)<input name="emergencyName" defaultValue={p.emergency_name} required /></label>
          <label>Telefone de emergência<input name="emergencyPhone" defaultValue={p.emergency_phone} inputMode="tel" required /></label>
        </div>
        <div><button className="primary" disabled={busy === 'profile'}>{busy === 'profile' ? 'Salvando…' : me.profile ? 'Atualizar dados' : 'Salvar e continuar'}</button></div>
      </form>

      {step >= 2 && (
        <div className="card stack">
          <div><h2>2. Selfie e documentos</h2><p className="muted">Fotos nítidas ou PDF, até 5 MB. Ficam em área privada; só a equipe autorizada da UP Service consulta, e todo acesso fica registrado.</p></div>
          {DOCS.map((d) => {
            const current = me.documents.find((x) => x.type === d.type);
            return (
              <div key={d.type} className="subpanel row between">
                <div>
                  <span className="strong">{d.name}</span> {current && <StatusBadge status={current.status} />}
                  <span className="muted" style={{ display: 'block' }}>{d.hint}</span>
                  {current?.rejection_reason && <span className="text-danger" style={{ display: 'block' }}>Motivo da rejeição: {current.rejection_reason}</span>}
                </div>
                {d.type === 'SELFIE' && current && <img className="selfie-thumb" src={`/api/files/doc/${current.id}`} alt="Sua selfie" />}
                {d.type === 'SELFIE' ? current?.status !== 'APROVADO' && (
                  <button className={`sm${current ? '' : ' primary'}`} disabled={busy === 'SELFIE'} onClick={() => setCamera(true)}>
                    <Icon name="user" size={16} />{busy === 'SELFIE' ? 'Enviando…' : current ? 'Tirar outra' : 'Tirar selfie'}
                  </button>
                ) : current?.status !== 'APROVADO' && (
                  <label className={`btn sm${current ? '' : ' primary'}`}>
                    <Icon name="file" size={16} />{busy === d.type ? 'Enviando…' : current ? 'Substituir' : 'Enviar'}
                    <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => upload(d.type, e.target.files?.[0])} />
                  </label>
                )}
              </div>
            );
          })}
          {camera && <div className="subpanel"><Selfie onCapture={sendSelfie} onCancel={() => setCamera(false)} /></div>}
        </div>
      )}

      {step >= 3 && (
        <div className="card stack">
          <h2>3. Termos e privacidade</h2>
          <ul className="muted" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
            <li>Ao fazer check-in, pausa, retorno e checkout, o app registra sua <b>localização GPS</b> e uma <b>selfie</b>, junto com o horário do servidor.</li>
            <li>Esses registros servem para comprovar sua presença na loja e calcular as horas da diária.</li>
            <li>Durante a atividade, com a tela do app aberta, a localização também é conferida a cada 10 minutos. Na pausa e com a tela fechada, nada é lido. Guardamos só a última leitura e eventuais saídas do raio da loja, nunca o trajeto.</li>
            <li>Selfies e documentos são vistos apenas por gestores da loja e administradores da UP Service, e todo acesso fica registrado.</li>
            <li>Os dados são mantidos por 5 anos. Você pode consultar e atualizar seus próprios dados a qualquer momento.</li>
          </ul>
          <p className="muted">Leia a <a href="/privacidade.html" target="_blank">Política de Privacidade</a> e os <a href="/termos.html" target="_blank">Termos de Uso</a> completos.</p>
          {me.profile?.terms_accepted_at ? (
            <Alert kind="success">Termos aceitos.</Alert>
          ) : (
            <div><button className="primary" disabled={busy === 'terms'} onClick={() => run('terms', () => api('/me/terms', { body: { accept: true } }), 'Cadastro completo!')}>Li e aceito</button></div>
          )}
        </div>
      )}

      {me.complete && <button className="primary big" onClick={() => navigate('/vagas')}>Ver vagas disponíveis</button>}
    </div>
  );
}
