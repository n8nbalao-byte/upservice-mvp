// "Cabe na tela": telas que ocupam exatamente a janela mostram só as linhas que cabem (Dashboard, Minhas diárias).
import { useCallback, useEffect, useRef, useState } from 'react';

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** Quantas linhas de altura fixa cabem no elemento (a altura vem da grade, não do conteúdo). */
export function useFit(rowHeight: number, reserved = 0) {
  const [n, setN] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([e]) => setN(Math.max(1, Math.floor((e.contentRect.height - reserved) / rowHeight))));
    observer.current.observe(el);
  }, [rowHeight, reserved]);
  return [ref, n] as const;
}
