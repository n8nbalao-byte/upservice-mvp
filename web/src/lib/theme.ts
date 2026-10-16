// Perfil de cores global (escolhido pelo administrador principal; vem de /api/config). Guardado também no navegador
// só para aplicar já no carregamento, sem piscar o tema errado; o valor que vale é sempre o do servidor.
export type Theme = 'padrao' | 'atacadao';

export function applyTheme(theme: Theme | null | undefined) {
  const t: Theme = theme === 'atacadao' ? 'atacadao' : 'padrao';
  document.documentElement.dataset.themeBrand = t;
  try { localStorage.setItem('theme-brand', t); } catch { /* sem armazenamento: só não lembra entre visitas */ }
}

export function applyStoredTheme() {
  try { applyTheme(localStorage.getItem('theme-brand') as Theme | null); } catch { applyTheme('padrao'); }
}
