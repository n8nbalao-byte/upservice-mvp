// Modelos (templates) de mensagem da API oficial do WhatsApp. Mensagem que a UP manda primeiro só sai por modelo
// aprovado pela Meta; o app cadastra estes em Configurações → WhatsApp → "Enviar modelos para aprovação".
// Regras da Meta: o texto não começa nem termina com variável; duas variáveis nunca separadas só por espaço ou
// pontuação; no máximo 1 variável a cada 3 palavras; variável sem quebra de linha (o envio troca por espaço).
// `aviso`: chave do liga/desliga em Configurações (o código de acesso não desliga).
const APP_URL = () => (process.env.APP_URL || 'https://app.upserviceintermed.com').replace(/\/+$/, '');
const abrir = (text, exemplo) => ({ type: 'URL', text, url: `${APP_URL()}/{{1}}`, example: [`${APP_URL()}/${exemplo}`] });
const fixo = (text, path) => ({ type: 'URL', text, url: `${APP_URL()}/${path}` });
const resposta = (text) => ({ type: 'QUICK_REPLY', text });

export const AVISOS = {
  reserva: 'Saiu da reserva (vaga confirmada)',
  vespera: 'Lembrete da véspera (Vou / Não vou)',
  checkin: 'Check-in aberto',
  pausa: 'Pausa acabando e pausa vencida',
  checkout: 'Checkout esquecido',
  pagamento: 'Pagamento feito',
  quebra: 'Quebra de caixa',
  pix: 'Chave Pix trocada',
  sorteio: 'Sorteio de brinde',
};

export const MODELOS = {
  codigo_acesso: { categoria: 'AUTHENTICATION', label: 'Código de acesso e de confirmação do número' },
  saiu_da_reserva: {
    aviso: 'reserva',
    texto: 'Olá, {{1}}! Boa notícia: abriu uma vaga e você saiu da reserva. ✅\n\nVocê está confirmado(a) em {{2}}, na loja {{3}}, no dia {{4}}.\n\nNo dia, faça o check-in pelo app. Se não puder ir, desista pelo app ou pelo botão abaixo, para chamar o próximo da reserva.',
    exemplo: ['Maria', 'Repositor', 'Atacadão Itaquera', 'sex 24/10 08:00'],
    botoes: [fixo('Minhas diárias', 'minhas'), resposta('Não vou poder ir')],
  },
  lembrete_vespera: {
    aviso: 'vespera',
    texto: 'Lembrete da UP Service: {{1}} às {{2}} você tem diária de *{{3}}* em {{4}}.\n\nVocê vai?',
    exemplo: ['Amanhã', '08:00', 'Repositor', 'ATC-001 · Atacadão Itaquera'],
    botoes: [resposta('Vou'), resposta('Não vou')],
  },
  checkin_aberto: {
    aviso: 'checkin',
    texto: 'O check-in da sua diária de *{{1}}* (loja {{2}}, às {{3}}) já está aberto. Faça pelo app, dentro da loja.',
    exemplo: ['Repositor', 'ATC-001', '08:00'],
    botoes: [abrir('Fazer check-in', 'atividade/1')],
  },
  pausa_terminando: {
    aviso: 'pausa',
    label: 'Pausa acabando',
    texto: 'Sua pausa termina às {{1}}. Volte e registre o retorno pelo app.',
    exemplo: ['12:30'],
    botoes: [abrir('Registrar retorno', 'atividade/1')],
  },
  pausa_terminou: {
    aviso: 'pausa',
    label: 'Pausa vencida',
    texto: '⚠️ O tempo da sua pausa terminou. Registre o retorno agora pelo app.',
    botoes: [abrir('Registrar retorno', 'atividade/1')],
  },
  checkout_pendente: {
    aviso: 'checkout',
    texto: '⚠️ O horário da diária de *{{1}}* em {{2}} terminou e o checkout não foi feito. Faça agora pelo app.',
    exemplo: ['Repositor', 'Atacadão Itaquera'],
    botoes: [abrir('Fazer checkout', 'atividade/1')],
  },
  pagamento_feito: {
    aviso: 'pagamento',
    texto: 'UP Service: pagamento de {{1}} feito na sua chave Pix. O comprovante está na sua Carteira, no app.',
    exemplo: ['R$ 120,00'],
    botoes: [fixo('Ver comprovante', 'carteira')],
  },
  quebra_caixa: {
    aviso: 'quebra',
    texto: 'Aviso da UP Service sobre quebra de caixa: {{1}}.\n\nDetalhes: {{2}}\n\nVeja na sua Carteira, no app.',
    exemplo: ['Quebra de caixa registrada: R$ 15,00', 'Diária de 24/10 (Operador de caixa · Atacadão Itaquera). Motivo: diferença no fechamento.'],
    botoes: [fixo('Abrir a Carteira', 'carteira'), resposta('Ver quebras')],
  },
  pix_trocado: {
    aviso: 'pix',
    texto: 'UP Service: a chave Pix da sua conta foi trocada agora. Se não foi você, fale com a UP Service imediatamente.',
    botoes: [fixo('Abrir o app', 'carteira')],
  },
  sorteio_ganho: {
    aviso: 'sorteio',
    texto: 'UP Service: você ganhou o sorteio de {{1}}! Você fez 3 estrelas em {{2}} e foi sorteado(a) entre {{3}} participante(s). A UP Service vai combinar a entrega com você.',
    exemplo: ['Fone de ouvido', '24/10', '12'],
    botoes: [fixo('Ver Estrelas', 'estrelas')],
  },
};

/** Corpo do cadastro na Meta (POST /{waba}/message_templates). */
export function cadastroModelo(nome) {
  const m = MODELOS[nome];
  if (m.categoria === 'AUTHENTICATION') {
    return {
      name: nome, language: 'pt_BR', category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 5 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copiar código' }] },
      ],
    };
  }
  const components = [{ type: 'BODY', text: m.texto, ...(m.exemplo ? { example: { body_text: [m.exemplo] } } : {}) }];
  if (m.botoes?.length) components.push({ type: 'BUTTONS', buttons: m.botoes });
  return { name: nome, language: 'pt_BR', category: 'UTILITY', components };
}

const limpa = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 900) || '-';

/** Partes variáveis do envio: textos do corpo, sufixo do link (botão de URL com {{1}}) e o que volta ao tocar nos
 *  botões de resposta (`respostas`, na ordem dos botões). */
export function componentesEnvio(nome, { vars = [], link, respostas = [] } = {}) {
  const m = MODELOS[nome];
  if (m.categoria === 'AUTHENTICATION') {
    return [{ type: 'body', parameters: [{ type: 'text', text: vars[0] }] }, { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: vars[0] }] }];
  }
  const out = vars.length ? [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: limpa(v) })) }] : [];
  let r = 0;
  (m.botoes ?? []).forEach((b, i) => {
    if (b.type === 'URL' && b.url.includes('{{1}}')) out.push({ type: 'button', sub_type: 'url', index: String(i), parameters: [{ type: 'text', text: String(link ?? '') }] });
    if (b.type === 'QUICK_REPLY') {
      const payload = respostas[r++];
      if (payload) out.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: JSON.stringify(payload) }] });
    }
  });
  return out;
}
