import { CloudUpload, Zap } from "lucide-react";
import shared from "@/components/admin/shared/admin-shared.module.css";

/** Inside of the photo box of the new-product capture: icon, title, formats and the backdrop tip. */
export function PhotoDropzoneContent({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <span aria-hidden="true" className={shared.dropzoneIcon}>
        <CloudUpload size={26} />
      </span>
      <strong>{title}</strong>
      <span>{detail}</span>
      <span className={shared.dropzoneTip}>
        <Zap aria-hidden="true" size={12} /> Mejor con fondo oscuro y buena luz
      </span>
    </>
  );
}
