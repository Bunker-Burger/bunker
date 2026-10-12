"use client";

import { Camera } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "../../admin.module.css";
import { FieldError } from "../admin-form";
import { ACCEPTED_IMAGE_TYPES } from "../catalogo/image-form";
import { PhotoDropzoneContent } from "../catalogo/photo-dropzone";

export interface PromotionPhoto {
  url: string | null;
  maxBytes: number;
  minSide: number;
  maxSide: number;
}

/**
 * First card of the promotion form, as in the capture: the photo for the banner at the top of the
 * menu (issue #54). It travels with the promotion's own form and is uploaded after the promotion
 * is saved; type, size and dimensions are checked again on the server.
 */
export function PromotionPhotoField({ photo }: { photo: PromotionPhoto }) {
  const [preview, setPreview] = useState<string | null>(photo.url);
  const [localWarning, setLocalWarning] = useState<string | null>(null);
  const [remove, setRemove] = useState(false);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <fieldset className={`${styles.formCard} ${styles.promoCard}`}>
      <legend>
        <span className={styles.promoLegend}>
          <Camera aria-hidden="true" size={18} /> Foto de la promo
        </span>
      </legend>
      <div className={styles.field}>
        <label className={styles.dropzone} htmlFor="promotion-image">
          <PhotoDropzoneContent detail="Formato JPG, PNG, WebP o AVIF, 16:9 o cuadrado · Alta resolución" title={photo.url ? "Reemplazar foto de la promo" : "Subir foto de la promo"} />
        </label>
        <input
          accept={ACCEPTED_IMAGE_TYPES}
          aria-describedby="promotion-image-hint promotion-image-error"
          aria-label={photo.url ? "Reemplazar foto de la promo" : "Subir foto de la promo"}
          className={styles.dropzoneInput}
          id="promotion-image"
          name="image"
          onChange={(event) => {
            const file = event.target.files?.[0];
            setLocalWarning(file && file.size > photo.maxBytes ? "La imagen supera los 5 MB; el servidor la va a rechazar." : null);
            setPreview(file ? URL.createObjectURL(file) : photo.url);
            if (file) setRemove(false);
          }}
          type="file"
        />
        <small className={styles.hint} id="promotion-image-hint">
          Se muestra arriba de la carta mientras la promoción está vigente. JPEG, PNG, WebP o AVIF; hasta 5 MB y entre {photo.minSide} y {photo.maxSide} px por lado.
        </small>
        {localWarning ? <span className={styles.fieldError}>{localWarning}</span> : null}
        <FieldError id="promotion-image-error" name="image" />
      </div>
      {preview && !remove ? (
        <div className={styles.promoPhotoPreview}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored photo or local preview (blob URL) */}
          <img alt="" src={preview} />
        </div>
      ) : null}
      {photo.url ? (
        <label className={styles.visibleCheck}>
          <input checked={remove} name="removeImage" onChange={(event) => setRemove(event.target.checked)} type="checkbox" value="true" /> Quitar la foto al guardar
        </label>
      ) : null}
    </fieldset>
  );
}
