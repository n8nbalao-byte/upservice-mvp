// Quantos e-mails não lidos tem a caixa da UP Service (a mesma conta do SMTP), para o número no menu "E-mail".
// Só o comando STATUS do IMAP: não abre nem marca nenhum e-mail como lido.
import tls from 'node:tls';

const quote = (s) => `"${String(s).replace(/[\\"]/g, (c) => '\\' + c)}"`;

function status(host, user, pass) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: 993, servername: host, timeout: 15000 });
    let buf = '', step = 0;
    const fim = (erro, n) => { sock.destroy(); if (erro) reject(erro); else resolve(n); };
    sock.on('timeout', () => fim(new Error('tempo esgotado')));
    sock.on('error', fim);
    sock.on('data', (d) => {
      buf += d;
      if (step === 0 && buf.includes('\r\n')) {
        step = 1; buf = '';
        sock.write(`a1 LOGIN ${quote(user)} ${quote(pass)}\r\n`);
      } else if (step === 1 && /^a1 /m.test(buf)) {
        if (!/^a1 OK/m.test(buf)) return fim(new Error('login recusado'));
        step = 2; buf = '';
        sock.write('a2 STATUS INBOX (UNSEEN)\r\n');
      } else if (step === 2 && /^a2 /m.test(buf)) {
        const m = buf.match(/UNSEEN (\d+)/);
        sock.write('a3 LOGOUT\r\n');
        fim(m ? null : new Error('resposta inesperada'), m && Number(m[1]));
      }
    });
  });
}

let cache = { at: 0, n: null, pending: null };

/** Não lidos na caixa de entrada (cache de 60 s); null sem e-mail configurado ou se o IMAP falhar. */
export async function emailsNaoLidos() {
  if (!process.env.SMTP_USER) return null;
  if (Date.now() - cache.at < 60000) return cache.n;
  cache.pending ??= status(process.env.IMAP_HOST || 'imap.hostinger.com', process.env.SMTP_USER, process.env.SMTP_PASS)
    .catch((e) => { console.error('IMAP: não deu para contar os e-mails não lidos', e.message); return null; })
    .then((n) => { cache = { at: Date.now(), n, pending: null }; return n; });
  return cache.pending;
}
