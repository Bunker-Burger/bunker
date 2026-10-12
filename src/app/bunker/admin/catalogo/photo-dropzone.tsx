import { CloudUpload, Zap } from "lucide-react";
import styles from "../../admin.module.css";

/** Inside of the photo box of the new-product capture: icon, title, formats and the backdrop tip. */
export function PhotoDropzoneContent({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <span aria-hidden="true" className={styles.dropzoneIcon}>
        <CloudUpload size={26} />
      </span>
      <strong>{title}</strong>
      <span>{detail}</span>
      <span className={styles.dropzoneTip}>
        <Zap aria-hidden="true" size={12} /> Fondo oscuro Maillard recomendado
      </span>
    </>
  );
}
