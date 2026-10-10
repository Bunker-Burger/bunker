"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import styles from "../../admin.module.css";
import { deleteProductImageAction, saveProductImageAction } from "./actions";
import { AdminForm, FieldError, TextField } from "./admin-form";

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/avif";

interface ImageFormProps {
  productId: string;
  productName: string;
  image: { url: string; alt: string; focalX: number; focalY: number } | null;
  maxBytes: number;
  minSide: number;
  maxSide: number;
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * Upload, replacement and focal point of the product photo. The preview crops like the menu
 * does, so the focal point can be checked before saving. Type, size and dimensions are checked
 * again on the server from the file's bytes; the hints here only save a round trip.
 */
export function ImageForm({ productId, productName, image, maxBytes, minSide, maxSide }: ImageFormProps) {
  const [focal, setFocal] = useState({ x: image?.focalX ?? 50, y: image?.focalY ?? 50 });
  const [preview, setPreview] = useState<string | null>(image?.url ?? null);
  const [localWarning, setLocalWarning] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const pickFocal = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setFocal({ x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100) });
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setFocal((current) => ({ x: clamp(current.x + move[0]), y: clamp(current.y + move[1]) }));
  };

  return (
    <div className={styles.imageEditor}>
      <AdminForm action={saveProductImageAction} submitLabel={image ? "Guardar foto" : "Subir foto"} pendingLabel="Subiendo…">
        <input name="productId" type="hidden" value={productId} />
        <div className={styles.field}>
          <label htmlFor="product-image">{image ? "Reemplazar foto" : "Foto"}</label>
          <input
            accept={ACCEPTED_IMAGE_TYPES}
            aria-describedby="image-hint image-error"
            id="product-image"
            name="image"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setLocalWarning(file && file.size > maxBytes ? "La imagen supera los 5 MB; el servidor la va a rechazar." : null);
              setPreview(file ? URL.createObjectURL(file) : (image?.url ?? null));
            }}
            type="file"
          />
          <small className={styles.hint} id="image-hint">
            JPEG, PNG, WebP o AVIF; hasta 5 MB y entre {minSide} y {maxSide} px por lado. SVG no.
          </small>
          {localWarning ? <span className={styles.fieldError}>{localWarning}</span> : null}
          <FieldError id="image-error" name="image" />
        </div>

        {preview ? (
          <div className={styles.focalPreviewWrap}>
            <div
              aria-label="Punto focal: hacé clic en la foto o usá las flechas"
              className={styles.focalPreview}
              onClick={pickFocal}
              onKeyDown={nudge}
              role="group"
              tabIndex={0}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) of the photo being uploaded */}
              <img alt="" src={preview} style={{ objectPosition: `${focal.x}% ${focal.y}%` }} />
              <span aria-hidden="true" className={styles.focalMarker} style={{ left: `${focal.x}%`, top: `${focal.y}%` }} />
            </div>
          </div>
        ) : null}

        <div className={styles.focalInputs}>
          <TextField label="Punto focal horizontal (%)" max={100} min={0} name="focalX" onChange={(event) => setFocal((f) => ({ ...f, x: clamp(Number(event.target.value)) }))} type="number" value={focal.x} />
          <TextField label="Punto focal vertical (%)" max={100} min={0} name="focalY" onChange={(event) => setFocal((f) => ({ ...f, y: clamp(Number(event.target.value)) }))} type="number" value={focal.y} />
        </div>
        <TextField defaultValue={image?.alt ?? ""} hint={`Describe la foto para lectores de pantalla. Si lo dejás vacío se usa “${productName}”.`} label="Texto alternativo" maxLength={180} name="altText" />
      </AdminForm>

      {image ? (
        <details className={styles.disclosure}>
          <summary>Eliminar foto</summary>
          <AdminForm action={deleteProductImageAction} pendingLabel="Eliminando…" submitLabel="Eliminar foto" submitVariant="danger">
            <input name="productId" type="hidden" value={productId} />
          </AdminForm>
        </details>
      ) : null}
    </div>
  );
}
