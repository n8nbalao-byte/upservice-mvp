import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge } from '../components/ui';
import { api, fmtDate, fmtMinutes, fmtMoney, fmtTime, label, type Unit } from '../lib/api';

const dayBR = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const SOURCES: [string, string][] = [['GPS_VALIDADO', 'GPS validado'], ['EXCECAO_APROVADA', 'Exceção aprovada'], ['FECHAMENTO_ADMINISTRATIVO', 'Fechamento administrativo']];
const PAGE = 50;
const UNITS_PREVIEW = 10;
const SHORT: Record<string, string> = { GPS_VALIDADO: 'GPS', EXCECAO_APROVADA: 'Exceção', FECHAMENTO_ADMINISTRATIVO: 'Fech. adm.' };

type UnitRow = { unitId: string; code: string; name: string; approved: number; concluded: number; absences: number; workedMin: number; value: number };
type Report = { indicators: Record<string, any>; byUnit: UnitRow[]; rows: any[]; truncated: boolean; totalRows: number };

export default function Relatorios() {
  const { me } = useMe();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState(dayBR(-6));
  const [to, setTo] = useState(dayBR(0));
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [allUnits, setAllUnits] = useState(false);
  const [error, setError] = useState('');

  const qs = new URLSearchParams({ from, to, ...(unitId ? { unitId } : {}) }).toString();
  const load = () => {
    setError('');
    setBusy(true);
    setVisible(PAGE);
    api<Report>(`/manage/reports?${qs}`).then(setReport, (e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { api<Unit[]>('/units').then(setUnits); load(); }, []);

  const ind = report?.indicators;
  const totalSources = ind ? SOURCES.reduce((t, [k]) => t + (ind.sources[k] ?? 0), 0) : 0;
  const pct = (n: number) => (totalSources ? Math.round((n / totalSources) * 100) : 0);
  const totals = report?.byUnit.reduce((t, u) => ({ approved: t.approved + u.approved, concluded: t.concluded + u.concluded, absences: t.absences + u.absences, workedMin: t.workedMin + u.workedMin, value: t.value + u.value }), { approved: 0, concluded: 0, absences: 0, workedMin: 0, value: 0 });

  return (
    <div className="page">
      <PageHeader title="Relatórios" description="Diárias, horas, origem dos registros e ocorrências por período (até 31 dias)." />

      <div className="card">
        <div className="filters">
          <label>Unidade
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">{me.user.role === 'ADMINISTRADOR' ? 'Todas as unidades' : 'Todas as minhas unidades'}</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
          </label>
          <label>De<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={load}>{busy ? 'Gerando…' : 'Gerar relatório'}</button>
            <a className="btn" href={`/api/manage/reports/export.csv?${qs}`}><Icon name="download" size={18} />Exportar CSV</a>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>O CSV abre direto no Excel, não traz documentos nem e-mail e toda exportação fica registrada na auditoria.</p>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      {!ind && busy && <Loading text="Gerando relatório…" />}

      {ind && report && (
        <>
          <section className="stack">
            <h2 className="section-title">Operação</h2>
            <div className="stats">
              <Stat label="Vagas" value={ind.jobs} />
              <Stat label="Posições" value={ind.positions} />
              <Stat label="Candidaturas" value={ind.applications} />
              <Stat label="Aprovadas" value={ind.approved} tone="gold" hint={ind.positions ? `${Math.round((ind.approved / ind.positions) * 100)}% das posições` : undefined} />
            </div>
          </section>

          <section className="stack">
            <h2 className="section-title">Resultado</h2>
            <div className="stats">
              <Stat label="Diárias concluídas" value={ind.concluded} tone="success" />
              <Stat label="Faltas" value={ind.absences} tone={ind.absences ? 'danger' : 'neutral'} />
              <Stat label="Horas trabalhadas" value={fmtMinutes(ind.workedMin)} tone="info" />
              <Stat label="Valor das diárias concluídas" value={fmtMoney(ind.value)} tone="gold" />
            </div>
          </section>

          <div className="grid-2">
            <section className="card stack">
              <div className="card-header" style={{ marginBottom: 0 }}><h2>Qualidade do registro</h2><span className="sub">{totalSources} registros de presença</span></div>
              {SOURCES.map(([k, text]) => (
                <div key={k} className="progress">
                  <div className="row between"><span>{text}</span><span className="tabular strong">{ind.sources[k] ?? 0} · {pct(ind.sources[k] ?? 0)}%</span></div>
                  <div className="bar"><span style={{ width: `${pct(ind.sources[k] ?? 0)}%`, background: k === 'GPS_VALIDADO' ? 'var(--success)' : 'var(--gold)' }} /></div>
                </div>
              ))}
              <p className="muted">Exceções: {ind.exceptions.APROVADA ?? 0} aprovadas · {ind.exceptions.RECUSADA ?? 0} recusadas · {ind.exceptions.PENDENTE ?? 0} pendentes</p>
            </section>
            <section className="card stack">
              <div className="card-header" style={{ marginBottom: 0 }}><h2>Ocorrências e alertas</h2></div>
              {Object.keys(ind.occurrences).length === 0 ? <p className="muted">Nenhuma ocorrência confirmada no período.</p> : (
                <div className="row">{Object.entries(ind.occurrences).map(([k, v]) => <StatusBadge key={k} status={k}>{label(k)}: {String(v)}</StatusBadge>)}</div>
              )}
              <p><span className="strong tabular">{ind.locationAlerts}</span> <span className="muted">alerta(s) de saída do raio</span></p>
            </section>
          </div>

          {report.byUnit.length > 1 && totals && (
            <div className="card tight">
              <div className="card-header"><h2>Por unidade</h2><span className="sub">{report.byUnit.length} unidades</span></div>
              <div className="table-wrap">
                <table className="responsive">
                  <thead><tr><th>Unidade</th><th className="num">Aprovadas</th><th className="num">Concluídas</th><th className="num">Faltas</th><th className="num">Horas</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {(allUnits ? report.byUnit : report.byUnit.slice(0, UNITS_PREVIEW)).map((u) => (
                      <tr key={u.unitId}>
                        <td data-label="Unidade"><span className="strong">{u.code}</span><span className="muted">{u.name}</span></td>
                        <td data-label="Aprovadas" className="num">{u.approved}</td>
                        <td data-label="Concluídas" className="num">{u.concluded}</td>
                        <td data-label="Faltas" className={`num${u.absences ? ' text-danger' : ''}`}>{u.absences}</td>
                        <td data-label="Horas" className="num">{fmtMinutes(u.workedMin)}</td>
                        <td data-label="Valor" className="num">{fmtMoney(u.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr><td>Total</td><td className="num">{totals.approved}</td><td className="num">{totals.concluded}</td><td className="num">{totals.absences}</td><td className="num">{fmtMinutes(totals.workedMin)}</td><td className="num">{fmtMoney(totals.value)}</td></tr>
                  </tfoot>
                </table>
              </div>
              {report.byUnit.length > UNITS_PREVIEW && (
                <div className="card-footer">
                  <span className="muted">{allUnits ? `${report.byUnit.length} unidades` : `Mostrando ${UNITS_PREVIEW} de ${report.byUnit.length} (o total considera todas)`}</span>
                  <button className="sm" onClick={() => setAllUnits(!allUnits)}>{allUnits ? 'Mostrar menos' : 'Mostrar todas'}</button>
                </div>
              )}
            </div>
          )}

          <div className="card tight">
            <div className="card-header"><h2>Diárias</h2><span className="sub">{report.totalRows} no período{report.truncated && ` · mostrando as primeiras ${report.rows.length} (o CSV traz todas)`}</span></div>
            {report.rows.length === 0 ? <EmptyState icon="chart" title="Nenhuma diária no período" text="Ajuste a unidade ou as datas e gere de novo." /> : (
              <div className="table-wrap">
                <table className="responsive">
                  <thead><tr><th>Data</th><th>Unidade</th><th>Profissional</th><th>Jornada</th><th>Entrada–saída</th><th className="num">Horas</th><th>Origem</th><th>Diária</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {report.rows.slice(0, visible).map((x) => (
                      <tr key={x.application_id}>
                        <td data-label="Data"><span className="strong">{fmtDate(x.starts_at)}</span><span className="muted">{x.title}</span></td>
                        <td data-label="Unidade">{x.unit_code}</td>
                        <td data-label="Profissional">{x.worker_name}</td>
                        <td data-label="Jornada"><StatusBadge status={x.session_status} /></td>
                        <td data-label="Entrada–saída" className="tabular nowrap">{x.checkin ? fmtTime(x.checkin) : '—'} – {x.checkout ? fmtTime(x.checkout) : '—'}</td>
                        <td data-label="Horas" className="num">{x.worked_min != null ? fmtMinutes(x.worked_min) : '—'}</td>
                        <td data-label="Origem">{x.sources ? x.sources.split(',').map((k: string) => SHORT[k] ?? k).join(' + ') : '—'}</td>
                        <td data-label="Diária">{x.result ? <StatusBadge status={x.result} /> : <span className="muted">a confirmar</span>}</td>
                        <td data-label="Valor" className="num">{fmtMoney(x.daily_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.rows.length > visible && (
              <div className="card-footer">
                <span className="muted">Mostrando {visible} de {report.rows.length}</span>
                <button className="sm" onClick={() => setVisible(visible + PAGE)}>Mostrar mais {Math.min(PAGE, report.rows.length - visible)}</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
