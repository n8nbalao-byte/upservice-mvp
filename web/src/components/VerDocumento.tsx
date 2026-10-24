import { useEffect, useRef, useState } from 'react';

/** Documento por cima do app (sem guia nova): foto ou PDF (páginas desenhadas pelo pdf.js, que funciona até no Android),
 *  com zoom (botões, toque ou pinça). Esc, X ou o fundo fecham. */
export function VerDocumento({ id, mime, title, onClose }: { id: string; mime: string; title: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const conteudo = useRef<HTMLImageElement & HTMLDivElement>(null);
  const base = useRef(0); // largura do documento cabendo na tela: o zoom multiplica a partir dela
  const [zoom, setZoom] = useState(1);
  const [erro, setErro] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const src = `/api/files/doc/${id}`;
  const pdf = mime === 'application/pdf';
  const set = (z: number) => {
    if (zoom === 1) base.current = conteudo.current?.clientWidth ?? 0;
    setZoom(Math.min(4, Math.max(1, z)));
  };

  useEffect(() => {
    if (!pdf) return;
    let parou = false;
    (async () => {
      // Versão "legacy": a normal usa recursos que celulares mais antigos ainda não têm (Uint8Array.toHex).
      const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const resp = await fetch(src);
      if (!resp.ok) throw new Error();
      const doc = await pdfjs.getDocument({ data: await resp.arrayBuffer() }).promise;
      for (let n = 1; n <= doc.numPages && !parou; n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 3 }); // nítido até o zoom de 2× a 3×
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        conteudo.current?.append(canvas);
      }
    })().catch((e) => { console.error(e); if (!parou) setErro('Não foi possível mostrar este PDF.'); });
    return () => { parou = true; };
  }, [src, pdf]);

  const estilo = zoom > 1 ? { width: base.current * zoom, maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' } : undefined;
  const alternar = () => set(zoom > 1 ? 1 : 2);

  return (
    <dialog ref={ref} className="doc-viewer" aria-label={title} onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="doc-viewer-bar">
        <b>{title}</b>
        <button type="button" className="sm" aria-label="Diminuir" disabled={zoom <= 1} onClick={() => set(zoom - 0.5)}>−</button>
        <button type="button" className="sm" aria-label="Aumentar" disabled={zoom >= 4} onClick={() => set(zoom + 0.5)}>+</button>
        <button type="button" className="sm" disabled={zoom === 1} onClick={() => set(1)}>Ajustar</button>
        <button type="button" className="doc-viewer-close" aria-label="Fechar" onClick={() => ref.current?.close()}>×</button>
      </div>
      <div className="doc-viewer-body">
        {erro ? <p className="doc-viewer-erro">{erro}</p>
          : pdf ? <div ref={conteudo} className="doc-viewer-pdf" role="img" aria-label={title} style={estilo} onClick={alternar} />
          : <img ref={conteudo} src={src} alt={title} style={estilo} onClick={alternar} />}
      </div>
    </dialog>
  );
}
