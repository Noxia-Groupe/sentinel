import { cn } from "@/lib/utils";

/**
 * Identité Sentinel : un bouclier (protection du parc) portant un œil de
 * veille (surveillance). Couleurs pleines — pas de dégradé à identifiant, pour
 * que plusieurs logos cohabitent sans conflit sur une même page.
 */
export function SentinelMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("h-8 w-8 shrink-0", className)}
    >
      <path
        d="M16 1.8 28.2 6.3v9.4c0 7.6-5.3 12.9-12.2 14.6C9.1 28.6 3.8 23.3 3.8 15.7V6.3Z"
        fill="#0251a1"
      />
      <path
        d="M16 1.8 28.2 6.3v9.4c0 7.6-5.3 12.9-12.2 14.6C9.1 28.6 3.8 23.3 3.8 15.7V6.3Z"
        fill="none"
        stroke="#4d9fe8"
        strokeOpacity={0.55}
        strokeWidth={1}
      />
      {/* Reflet haut du bouclier */}
      <path d="M16 3.4 26.7 7.4v2.1L16 5.6 5.3 9.5V7.4Z" fill="#4d9fe8" fillOpacity={0.35} />
      {/* Œil de veille */}
      <path
        d="M8.2 16.4c2.4-3.9 4.9-5.4 7.8-5.4s5.4 1.5 7.8 5.4c-2.4 3.9-4.9 5.4-7.8 5.4s-5.4-1.5-7.8-5.4Z"
        fill="none"
        stroke="#dde1e4"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16.4" r="3.1" fill="#dde1e4" />
      <circle cx="16" cy="16.4" r="1.25" fill="#000726" />
      <circle cx="17.1" cy="15.3" r="0.55" fill="#dde1e4" />
    </svg>
  );
}

/** Logo complet : pictogramme + nom du logiciel (+ sous-titre optionnel). */
export function SentinelLogo({
  subtitle,
  className,
  markClassName,
}: {
  subtitle?: string;
  className?: string;
  markClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <SentinelMark className={markClassName} />
      <div className="leading-tight">
        <p className="text-base font-extrabold tracking-[0.18em] text-[#dde1e4] uppercase">
          Sentinel
        </p>
        {subtitle && <p className="text-[11px] text-[#8896b4]">{subtitle}</p>}
      </div>
    </div>
  );
}

/** Mention discrète de l'auteur, en pied de page. */
export function OrizonLabCredit({ className }: { className?: string }) {
  return (
    <p className={cn("text-[10px] tracking-wide text-[#8896b4]/50", className)}>
      Sentinel · développé par OrizonLab
    </p>
  );
}
