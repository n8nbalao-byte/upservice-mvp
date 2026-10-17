import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Alert, EmptyState, PageHeader, Stat, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtMoney } from '../lib/api';
import { parseEscala, readXlsx, type Cell, type Escala } from '../lib/xlsx';

type Store = { filial: string; name: string; unit: { code: string; name: string } | null; days: number; positions: number; issues: Record<string, number> };
type Result = { dryRun: boolean; created: number; summary: { lines: number; jobs: number; positions: number; issues: Record<string, number> }; labels: Record<string, string>; stores: Store[] };

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fmtDay = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Escala mensal (planilha recebida do cliente) → vagas por loja e dia, com prévia antes de criar. */
export default function ImportarEscala() {
  const navigate = useNavigate();
  const { confirm, toast } = useDialog();
  const { busy, run } = useAction();
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<Cell[][]>();
  const [year, setYear] = useState('');
  const [escala, setEscala] = useState<Escala>();
  const [error, setError] = useState('');
  const [defaults, setDefaults] = useState<{ title: string; startTime: string; endTime: string; dailyValue: string; breakCount: string; breakMinutes: string; publish: boolean; isCashier?: boolean }>({ title: 'Repositor', startTime: '08:00', endTime: '16:00', dailyValue: '', breakCount: '1', breakMinutes: '15', publish: true });
  const [preview, setPreview] = useState<Result>();

  function interpret(r: Cell[][], y = year) {
    setError('');
    setPreview(undefined);
    try {
      setEscala(parseEscala(r, y ? { year: Number(y) } : {}));
    } catch (e: any) {
      setEscala(undefined);
      setError(e.message);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFile(f.name);
    try {
      const r = await readXlsx(await f.arrayBuffer());
      setRows(r);
      interpret(r);
    } catch (e: any) {
      setError(e.message || 'Não foi possível ler a planilha.');
    }
  }

  const body = (dryRun: boolean) => ({
    dryRun,
    items: escala!.items,
    defaults: { ...defaults, isCashier: defaults.isCashier ?? /\bcaixa\b/i.test(defaults.title), dailyValue: Number(defaults.dailyValue), breakCount: Number(defaults.breakCount), breakMinutes: Number(defaults.breakMinutes) },
  });

  function makePreview(e: FormEvent) {
    e.preventDefault();
    run('preview', async () => setPreview(await api<Result>('/manage/jobs/import', { body: body(true) })));
  }

  async function create() {
    if (!preview) return;
    const ok = await confirm({
      title: `Criar ${preview.summary.jobs} vagas?`,
      message: `${preview.summary.positions} posições no total, ${defaults.publish ? 'já publicadas para os profissionais' : 'como rascunho'}. As linhas com problema ficam de fora.`,
      confirmText: 'Criar vagas',
    });
    if (!ok) return;
    let r: Result | undefined;
    if (await run('create', async () => { r = await api<Result>('/manage/jobs/import', { body: body(false) }); })) {
      toast(`${r?.created} vagas criadas.`);
      navigate('/gestao/vagas');
    }
  }

  const set = (k: keyof typeof defaults, v: string | boolean) => { setDefaults((d) => ({ ...d, [k]: v })); setPreview(undefined); };
  const totalPositions = escala?.items.reduce((t, i) => t + i.positions, 0) ?? 0;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader back={{ to: '/gestao/vagas', label: 'Vagas' }} title="Importar escala do mês" description="Envie a planilha da escala (filial × dia × quantidade). O sistema cria uma vaga por loja e dia, com a quantidade de profissionais da planilha." />

      <section className="card stack">
        <h2>1. Planilha</h2>
        <label className="btn" style={{ justifySelf: 'start' }}>
          <Icon name="file" size={18} />{file || 'Escolher arquivo .xlsx'}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="muted">Formato esperado: coluna "Nº" com o número da filial, coluna "FILIAL" com o nome e uma coluna por dia. Linhas sem filial e a linha TOTAL são ignoradas.</p>
        {error && <Alert kind="danger">{error}</Alert>}
        {rows && (error.includes('ano') || !escala?.year) && (
          <label style={{ maxWidth: 200 }}>Ano da escala<input inputMode="numeric" maxLength={4} value={year} onChange={(e) => { setYear(e.target.value); if (e.target.value.length === 4) interpret(rows, e.target.value); }} /></label>
        )}
        {escala && (
          <div className="stats">
            <Stat label="Mês" value={escala.month ? `${MONTHS[escala.month - 1]} ${escala.year}` : `${fmtDay(escala.from)} a ${fmtDay(escala.to)}`} tone="accent" />
            <Stat label="Lojas na planilha" value={escala.stores.length} />
            <Stat label="Dias com escala" value={new Set(escala.items.map((i) => i.date)).size} hint={`${fmtDay(escala.from)} a ${fmtDay(escala.to)}`} />
            <Stat label="Profissionais (soma)" value={totalPositions.toLocaleString('pt-BR')} tone="info" />
          </div>
        )}
      </section>

      {escala && (
        <form className="card form" onSubmit={makePreview}>
          <h2>2. Padrões das vagas</h2>
          <p className="muted">Valem para todas as vagas desta importação. Depois dá para ajustar cada vaga em Vagas.</p>
          <div className="cols">
            <label>Função<input value={defaults.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={120} /></label>
            <label>Início<input type="time" value={defaults.startTime} onChange={(e) => set('startTime', e.target.value)} required /></label>
            <label>Término<input type="time" value={defaults.endTime} onChange={(e) => set('endTime', e.target.value)} required /><span className="hint">Antes do início = termina no dia seguinte</span></label>
            <label>Valor da diária (R$)<input type="number" min={0} step="0.01" value={defaults.dailyValue} onChange={(e) => set('dailyValue', e.target.value)} required /></label>
            <label>Pausas<input type="number" min={0} max={3} value={defaults.breakCount} onChange={(e) => set('breakCount', e.target.value)} required /></label>
            <label>Minutos por pausa<input type="number" min={1} max={120} value={defaults.breakMinutes} onChange={(e) => set('breakMinutes', e.target.value)} required /></label>
          </div>
          <label className="check"><input type="checkbox" checked={defaults.isCashier ?? /\bcaixa\b/i.test(defaults.title)} onChange={(e) => set('isCashier', e.target.checked)} /> Vagas de caixa (pode haver quebra de caixa, abatida da diária)</label>
          <label className="check"><input type="checkbox" checked={defaults.publish} onChange={(e) => set('publish', e.target.checked)} /> Publicar já para os profissionais (senão ficam como rascunho)</label>
          <div><button className="primary" disabled={busy === 'preview'}>{busy === 'preview' ? 'Conferindo…' : 'Ver prévia'}</button></div>
        </form>
      )}

      {preview && (
        <section className="card tight">
          <div className="card-header"><h2>3. Prévia</h2><span className="sub">Nada foi criado ainda</span></div>
          <div className="stats" style={{ padding: '0 20px 16px' }}>
            <Stat label="Vagas a criar" value={preview.summary.jobs} tone="success" hint={`${preview.summary.positions.toLocaleString('pt-BR')} posições${defaults.dailyValue ? ` · ${fmtMoney(preview.summary.positions * Number(defaults.dailyValue))} em diárias` : ''}`} />
            <Stat label="Linhas com problema" value={preview.summary.lines - preview.summary.jobs} tone={preview.summary.lines - preview.summary.jobs ? 'warning' : 'neutral'} hint="Ficam de fora; veja abaixo" />
          </div>
          {preview.stores.length === 0 ? <EmptyState title="Nenhuma linha" /> : (
            <div className="table-wrap">
              <table className="responsive">
                <thead><tr><th>Filial</th><th>Na planilha</th><th>Loja cadastrada</th><th className="num">Dias</th><th className="num">Posições</th><th>Problemas</th></tr></thead>
                <tbody>
                  {preview.stores.map((st) => (
                    <tr key={st.filial}>
                      <td data-label="Filial" className="strong">{st.filial}</td>
                      <td data-label="Na planilha">{st.name || <span className="muted">—</span>}</td>
                      <td data-label="Loja cadastrada">{st.unit ? <><span className="strong">{st.unit.code}</span><span className="muted">{st.unit.name}</span></> : <StatusBadge tone="danger">Não cadastrada</StatusBadge>}</td>
                      <td data-label="Dias" className="num">{st.days}</td>
                      <td data-label="Posições" className="num">{st.positions}</td>
                      <td data-label="Problemas">
                        {Object.keys(st.issues).length === 0 ? <StatusBadge tone="success">OK</StatusBadge> : Object.entries(st.issues).map(([k, n]) => (
                          <span key={k} className="muted">{preview.labels[k] ?? k}: {n}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="card-footer">
            <span className="muted">Filial não cadastrada: cadastre a loja (com o nº da filial) em Unidades e importe de novo; as vagas já criadas não se repetem.</span>
            <button className="primary" disabled={!preview.summary.jobs || busy === 'create'} onClick={create}>{busy === 'create' ? 'Criando…' : `Criar ${preview.summary.jobs} vagas`}</button>
          </div>
        </section>
      )}
    </div>
  );
}
