import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { api, fmtDate, fmtMinutes, fmtMoney, fmtTime, label, type Unit } from '../lib/api';

const dayBR = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const SOURCE = { GPS_VALIDADO: 'GPS', EXCECAO_APROVADA: 'Exceção', FECHAMENTO_ADMINISTRATIVO: 'Fechamento adm.' } as Record<string, string>;

type Report = {
  indicators: Record<string, any>;
  byUnit: { unitId: string; code: string; name: string; approved: number; concluded: number; absences: number; workedMin: number; value: number }[];
  rows: any[];
  truncated: boolean;
  totalRows: number;
};

export default function Relatorios() {
  const { me } = useMe();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState(dayBR(-6));
  const [to, setTo] = useState(dayBR(0));
  const [report, setReport] = useState<Report>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const qs = new URLSearchParams({ from, to, ...(unitId ? { unitId } : {}) }).toString();
  const load = () => {
    setError('');
    setBusy(true);
    api<Report>(`/manage/reports?${qs}`).then(setReport, (e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(() => { api<Unit[]>('/units').then(setUnits); load(); }, []);

  const ind = report?.indicators;
  const card = (value: React.ReactNode, text: string) => <div className="card stat"><b>{value}</b>{text}</div>;

  return (
    <div className="stack">
      <h1>Relatórios</h1>
      <div className="cols">
        <label>Unidade
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{me.user.role === 'ADMINISTRADOR' ? 'Todas as unidades' : 'Todas as minhas unidades'}</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        </label>
        <label>De<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Até<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={load}>{busy ? 'Gerando…' : 'Gerar relatório'}</button>
        <a className="button" href={`/api/manage/reports/export.csv?${qs}`}>Exportar CSV</a>
        <span className="muted">Período de até 31 dias. O CSV não traz documentos nem e-mail, e toda exportação fica registrada.</span>
      </div>
      {error && <p className="error">{error}</p>}

      {ind && (
        <>
          <div className="grid">
            {card(ind.jobs, 'vagas')}
            {card(ind.positions, 'posições')}
            {card(ind.applications, 'candidaturas')}
            {card(ind.approved, 'aprovadas')}
            {card(ind.concluded, 'diárias concluídas')}
            {card(ind.absences, 'faltas')}
            {card(fmtMinutes(ind.workedMin), 'horas trabalhadas')}
            {card(fmtMoney(ind.value), 'diárias concluídas (R$)')}
          </div>
          <div className="card stack">
            <div><b>Registros de presença por origem:</b> {Object.entries(SOURCE).map(([k, v]) => `${v}: ${ind.sources[k] ?? 0}`).join(' · ')}</div>
            <div><b>Exceções:</b> aprovadas {ind.exceptions.APROVADA ?? 0} · recusadas {ind.exceptions.RECUSADA ?? 0} · pendentes {ind.exceptions.PENDENTE ?? 0}</div>
            <div><b>Ocorrências confirmadas:</b> {Object.keys(ind.occurrences).length ? Object.entries(ind.occurrences).map(([k, v]) => `${label(k)}: ${v}`).join(' · ') : 'nenhuma'}</div>
            <div><b>Alertas de saída do raio:</b> {ind.locationAlerts}</div>
          </div>

          {report!.byUnit.length > 1 && (
            <div className="card scroll">
              <h2>Por unidade</h2>
              <table>
                <thead><tr><th>Unidade</th><th>Aprovadas</th><th>Concluídas</th><th>Faltas</th><th>Horas</th><th>Valor</th></tr></thead>
                <tbody>
                  {report!.byUnit.map((u) => (
                    <tr key={u.unitId}><td>{u.code} · {u.name}</td><td>{u.approved}</td><td>{u.concluded}</td><td>{u.absences}</td><td>{fmtMinutes(u.workedMin)}</td><td>{fmtMoney(u.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card scroll">
            <h2>Diárias ({report!.totalRows})</h2>
            {report!.truncated && <p className="muted">Mostrando as primeiras {report!.rows.length}. O CSV traz todas.</p>}
            <table>
              <thead><tr><th>Data</th><th>Unidade</th><th>Profissional</th><th>Jornada</th><th>Entrada–saída</th><th>Horas</th><th>Origem</th><th>Diária</th></tr></thead>
              <tbody>
                {report!.rows.map((x) => (
                  <tr key={x.application_id}>
                    <td>{fmtDate(x.starts_at)}<div className="muted">{x.title}</div></td>
                    <td>{x.unit_code}</td>
                    <td>{x.worker_name}</td>
                    <td>{label(x.session_status)}</td>
                    <td>{x.checkin ? fmtTime(x.checkin) : '—'}–{x.checkout ? fmtTime(x.checkout) : '—'}</td>
                    <td>{x.worked_min != null ? fmtMinutes(x.worked_min) : '—'}</td>
                    <td>{x.sources ? x.sources.split(',').map((k: string) => SOURCE[k] ?? k).join(' + ') : '—'}</td>
                    <td>{x.result ? label(x.result) : '—'}<div className="muted">{fmtMoney(x.daily_value)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
