"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Mail, MessageSquare, Network, X } from "lucide-react";
import { cn } from "@/lib/utils";

import type {
  DailyReportItem,
  DailyReportSource,
} from "@/lib/daily-report/schemas";

const SOURCE_ICON: Record<DailyReportSource, typeof Mail> = {
  wbs: Network,
  email: Mail,
  kakao: MessageSquare,
  orchestrator: Network,
};

const SOURCE_LABEL: Record<DailyReportSource, string> = {
  wbs: "WBS",
  email: "메일",
  kakao: "카카오",
  orchestrator: "통합",
};

const PRIORITY_STYLE: Record<DailyReportItem["priority"], string> = {
  high: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

interface ItemCardProps {
  item: DailyReportItem;
  applied: boolean;
  dismissed: boolean;
  busy: boolean;
  onApply: (item: DailyReportItem) => void;
  onDismiss: (item: DailyReportItem) => void;
  onDragStart?: (item: DailyReportItem) => void;
  onDragEnd?: () => void;
}

export function ItemCard({
  item,
  applied,
  dismissed,
  busy,
  onApply,
  onDismiss,
  onDragStart,
  onDragEnd,
}: ItemCardProps) {
  const SourceIcon = SOURCE_ICON[item.source] ?? Network;
  const draggable = !applied && !dismissed && !busy;
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return;
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(item);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={cn(
        "rounded-lg border bg-card p-3 transition-all",
        dismissed && "opacity-50",
        applied && "border-emerald-500/40",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <SourceIcon className="size-3" />
              {SOURCE_LABEL[item.source]}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "px-1.5 py-0 text-[10px] font-normal",
                PRIORITY_STYLE[item.priority],
              )}
            >
              {item.priority}
            </Badge>
            {item.dueDate && (
              <span className="text-[10px] text-muted-foreground">
                마감 {item.dueDate}
              </span>
            )}
            {item.projectName && (
              <span className="truncate text-[10px] text-muted-foreground">
                · {item.projectName}
              </span>
            )}
          </div>
          <div className="mt-1.5 text-sm font-medium leading-snug">
            {item.title}
          </div>
          {item.summary && (
            <div className="mt-1 text-xs text-muted-foreground">
              {item.summary}
            </div>
          )}
          {item.suggestedAction && (
            <div className="mt-1.5 text-xs text-primary">
              → {item.suggestedAction}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <Button
            size="sm"
            variant={applied ? "outline" : "default"}
            className="h-7 px-2 text-xs"
            disabled={applied || dismissed || busy}
            onClick={() => onApply(item)}
          >
            <Check className="size-3" />
            {applied ? "반영됨" : "내 업무"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={applied || dismissed || busy}
            onClick={() => onDismiss(item)}
          >
            <X className="size-3" />
            제외
          </Button>
        </div>
      </div>
    </div>
  );
}
