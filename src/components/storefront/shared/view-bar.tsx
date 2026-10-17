import { ArrowLeft } from "lucide-react";

/** Top bar of the cart and checkout screens: back arrow, store kicker and the screen title. */
export function ViewBar({ back, backLabel, title, titleId }: { back: string; backLabel: string; title: string; titleId: string }) {
  return (
    <div className="view-bar">
      <a aria-label={backLabel} className="view-back" href={back}>
        <ArrowLeft aria-hidden="true" size={20} />
      </a>
      <div>
        <span>BÚNKER BURGUER</span>
        <h2 id={titleId} tabIndex={-1}>{title}</h2>
      </div>
    </div>
  );
}
