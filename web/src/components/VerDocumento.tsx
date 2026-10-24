import { useEffect, useRef, useState } from 'react';

/** Documento por cima do app (sem guia nova): imagem com zoom (botões, toque ou pinça) ou PDF no leitor do navegador. Esc, X ou o fundo fecham. */
export function VerDocumento({ id, mime, title, onClose }: { id: string; mime: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const foto = useRef<HTMLImageElement>(null);
  const base = useRef(0); // largura da imagem cabendo na tela: o zoom multiplica a partir dela
  const [zoom, setZoom] = useState(1);
  useEffect(() => { ref.current?.showModal(); }, []);
  const src = `/api/files/doc/${id}`;
  const img = mime.startsWith('image/');
  const set = (z: number) => {
    if (zoom === 1) base.current = foto.current?.clientWidth ?? 0;
    setZoom(Math.min(4, Math.max(1, z)));
  };

  return (
    <dialog ref={ref} className="doc-viewer" aria-label={title} onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="doc-viewer-bar">
        <b>{title}</b>
        {img && <>
          <button type="button" className="sm" aria-label="Diminuir" disabled={zoom <= 1} onClick={() => set(zoom - 0.5)}>−</button>
          <button type="button" className="sm" aria-label="Aumentar" disabled={zoom >= 4} onClick={() => set(zoom + 0.5)}>+</button>
          <button type="button" className="sm" disabled={zoom === 1} onClick={() => set(1)}>Ajustar</button>
        </>}
        {/* O Chrome do Android não mostra PDF dentro da página: aí abre no leitor do aparelho. */}
        {!img && <a className="btn sm" href={src} target="_blank" rel="noreferrer">Abrir o PDF</a>}
        <button type="button" className="doc-viewer-close" aria-label="Fechar" onClick={() => ref.current?.close()}>×</button>
      </div>
      {img ? (
        <div className="doc-viewer-body">
          <img ref={foto} src={src} alt={title} style={zoom > 1 ? { width: base.current * zoom, maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' } : undefined} onClick={() => set(zoom > 1 ? 1 : 2)} />
        </div>
      ) : <iframe className="doc-viewer-body" src={src} title={title} />}
    </dialog>
  );
}
