"use client";

import { Camera, Move } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import { FieldError } from "@/components/admin/shared/admin-form";
import { PhotoDropzoneContent } from "./photo-dropzone";

export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/avif";

export interface PhotoValue {
  url: string | null;
  maxBytes: number;
  minSide: number;
  maxSide: number;
  /** Where the crop is centred (0–100). Only products keep it; without it the photo is not movable. */
  focal?: { x: number; y: number };
  /** Crop of the preview: the menu card (default) or the promotion banner. */
  frame?: "card" | "banner";
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * First card of the product and promotion forms, as in the captures (issue #54). The file travels
 * with the form and is uploaded once the product or promotion is saved. Products can be recentred
 * by dragging the preview (finger or mouse) or with the arrow keys; no numbers to type.
 * Type, size and dimensions are checked again on the server from the file's bytes.
 */
export function PhotoField({
  legend,
  uploadLabel,
  replaceLabel,
  hint,
  photo,
  onView
}: {
  legend: string;
  uploadLabel: string;
  replaceLabel: string;
  hint: string;
  photo: PhotoValue;
  /** What the menu would show now (chosen file, framing, or none), for a live preview. */
  onView?: (view: { url: string | null; focal: { x: number; y: number } }) => void;
}) {
  const [preview, setPreview] = useState<string | null>(photo.url);
  const [localWarning, setLocalWarning] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);
  const [focal, setFocal] = useState(photo.focal ?? { x: 50, y: 50 });
  const [moved, setMoved] = useState(false);
  const drag = useRef<{ x: number; y: number; focalX: number; focalY: number } | null>(null);
  const movable = photo.focal !== undefined;

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  useEffect(() => {
    onView?.({ url: remove ? null : preview, focal });
  }, [onView, preview, remove, focal]);

  const move = (x: number, y: number) => {
    setFocal({ x: clamp(x), y: clamp(y) });
    setMoved(true);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, focalX: focal.x, focalY: focal.y };
    try {
      // Keeps the drag when the finger leaves the frame; optional, the drag works without it.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };
  const onDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    // Dragging the photo right shows more of its left side, like moving a picture under a frame.
    move(drag.current.focalX - ((event.clientX - drag.current.x) / box.width) * 100, drag.current.focalY - ((event.clientY - drag.current.y) / box.height) * 100);
  };
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    move(focal.x + delta[0], focal.y + delta[1]);
  };

  const label = photo.url ? replaceLabel : uploadLabel;
  return (
    <fieldset className={shared.formCard}>
      <legend>
        <span className={shared.promoLegend}>
          <Camera aria-hidden="true" size={18} /> {legend}
        </span>
      </legend>
      <div className={shared.field}>
        <label className={shared.dropzone} htmlFor="photo-file">
          <PhotoDropzoneContent detail="Formato JPG, PNG, WebP o AVIF, cuadrado o 16:9 · Alta resolución" title={label} />
        </label>
        <input
          accept={ACCEPTED_IMAGE_TYPES}
          aria-describedby="photo-hint photo-error"
          aria-label={label}
          className={shared.dropzoneInput}
          id="photo-file"
          name="image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setLocalWarning(file && file.size > photo.maxBytes ? "La imagen supera los 5 MB; el servidor la va a rechazar." : null);
            setPreview(file ? URL.createObjectURL(file) : photo.url);
            if (file) setRemove(false);
          }}
          type="file"
        />
        <small className={shared.hint} id="photo-hint">
          {hint} JPEG, PNG, WebP o AVIF; hasta 5 MB y entre {photo.minSide} y {photo.maxSide} px por lado.
        </small>
        {localWarning ? <span className={shared.fieldError}>{localWarning}</span> : null}
        <FieldError id="photo-error" name="image" />
      </div>

      {preview && !remove ? (
        movable ? (
          <>
            <div
              aria-label="Acomodar la foto: arrastrala o usá las flechas"
              className={styles.photoFrame}
              data-frame={photo.frame ?? "card"}
              onKeyDown={nudge}
              onPointerCancel={() => (drag.current = null)}
              onPointerDown={startDrag}
              onPointerMove={onDrag}
              onPointerUp={() => (drag.current = null)}
              role="group"
              tabIndex={0}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- stored photo or local preview (blob URL) */}
              <img alt="" draggable={false} src={preview} style={{ objectPosition: `${focal.x}% ${focal.y}%` }} />
              <span aria-hidden="true" className={styles.photoFrameHint}>
                <Move size={14} /> Arrastrá para acomodar
              </span>
            </div>
            <input name="focalX" type="hidden" value={focal.x} />
            <input name="focalY" type="hidden" value={focal.y} />
            {moved ? <input name="photoMoved" type="hidden" value="true" /> : null}
          </>
        ) : (
          <div className={styles.promoPhotoPreview}>
            {/* eslint-disable-next-line @next/next/no-img-element -- stored photo or local preview (blob URL) */}
            <img alt="" src={preview} />
          </div>
        )
      ) : null}

      {photo.url ? (
        <label className={shared.visibleCheck}>
          <input checked={remove} name="removeImage" onChange={(event) => setRemove(event.target.checked)} type="checkbox" value="true" /> Quitar la foto al guardar
        </label>
      ) : null}
    </fieldset>
  );
}
