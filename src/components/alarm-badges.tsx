import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABELS, STATUS_LABELS, type EventSeverity, type EventStatus } from "@/lib/dahua/events";

/** Pastilles de criticité et de statut, partagées par toutes les vues d'alarmes. */

const SEVERITY_STYLES: Record<EventSeverity, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/25",
  major: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  minor: "bg-[#0251a1]/15 text-[#4d9fe8] border-[#0251a1]/30",
  info: "bg-[#8896b4]/10 text-[#8896b4] border-[#8896b4]/25",
};

const STATUS_STYLES: Record<EventStatus, string> = {
  new: "bg-red-500/10 text-red-400 border-red-500/25",
  acknowledged: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  in_progress: "bg-[#0251a1]/15 text-[#4d9fe8] border-[#0251a1]/30",
  resolved: "bg-green-500/10 text-green-400 border-green-500/25",
  ignored: "bg-[#8896b4]/10 text-[#8896b4] border-[#8896b4]/25",
};

export function SeverityBadge({ severity }: { severity: string }) {
  const key = (severity in SEVERITY_STYLES ? severity : "info") as EventSeverity;
  return <Badge className={SEVERITY_STYLES[key]}>{SEVERITY_LABELS[key]}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const key = (status in STATUS_STYLES ? status : "new") as EventStatus;
  return <Badge className={STATUS_STYLES[key]}>{STATUS_LABELS[key]}</Badge>;
}

/** Point coloré : signale la criticité dans les listes denses. */
export function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500",
    major: "bg-amber-500",
    minor: "bg-[#0251a1]",
    info: "bg-[#8896b4]",
  };
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${colors[severity] ?? colors.info}`}
      aria-hidden
    />
  );
}
