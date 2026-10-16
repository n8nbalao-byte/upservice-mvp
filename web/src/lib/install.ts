// Instalar o app na tela inicial (PWA). O Chrome/Edge avisam cedo que dá para instalar; guardamos o aviso
// para o botão "Instalar". No iPhone não existe instalação por botão: a página mostra o passo a passo do Safari.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  notify();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const onInstallChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const canPrompt = () => !!deferred;
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isMobile = () => isIos() || /Android/.test(navigator.userAgent);

export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}
