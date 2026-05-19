"use client";

import { useState, type DragEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, BookOpen, CalendarClock, Clock4, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

import {
  type DailyReportItem,
  type DailyReportSection,
} from "@/lib/daily-report/schemas";
import { ItemCard } from "./item-card";

const SECTION_META: Record<
  DailyReportSection,
  { label: string; icon: typeof Zap; tone: string; ring: string }
> = {
  immediate: {
    label: "즉시 처리",
    icon: Zap,
    tone: "text-red-600 dark:text-red-400",
    ring: "ring-red-500/40",
  },
  today: {
    label: "오늘 할 일",
    icon: CalendarClock,
    tone: "text-blue-600 dark:text-blue-400",
    ring: "ring-blue-500/40",
  },
  pending: {
    label: "대기/회신 필요",
    icon: Clock4,
    tone: "text-amber-600 dark:text-amber-400",
    ring: "ring-amber-500/40",
  },
  atRisk: {
    label: "지연 위험",
    icon: AlertTriangle,
    tone: "text-orange-600 dark:text-orange-400",
    ring: "ring-orange-500/40",
  },
  reference: {
    label: "참고",
    icon: BookOpen,
    tone: "text-muted-foreground",
    ring: "ring-foreground/30",
  },
};

const SECTION_ORDER: DailyReportSection[] = [
  "immediate",
  "today",
  "atRisk",
  "pending",
  "reference",
];

interface SectionListProps {
  items: DailyReportItem[];
  appliedIds: Set<string>;
  dismissedIds: Set<string>;
  busyItemId: string | null;
  onApply: (item: DailyReportItem) => void;
  onDismiss: (item: DailyReportItem) => void;
  onMoveItem: (itemId: string, section: DailyReportSection) => void;
}

export function SectionList({
  items,
  appliedIds,
  dismissedIds,
  busyItemId,
  onApply,
  onDismiss,
  onMoveItem,
}: SectionListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverSection, setHoverSection] = useState<DailyReportSection | null>(
    null,
  );

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: items.filter((it) => it.section === section),
  }));

  const handleDragOver = (
    e: DragEvent<HTMLDivElement>,
    section: DailyReportSection,
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hoverSection !== section) setHoverSection(section);
  };

  const handleDrop = (
    e: DragEvent<HTMLDivElement>,
    section: DailyReportSection,
  ) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData("text/plain");
    setHoverSection(null);
    setDraggingId(null);
    if (itemId) onMoveItem(itemId, section);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {grouped.map(({ section, items: bucket }) => {
        const meta = SECTION_META[section];
        const Icon = meta.icon;
        const isHover = hoverSection === section;
        return (
          <Card
            key={section}
            onDragOver={(e) => handleDragOver(e, section)}
            onDragLeave={() => setHoverSection((prev) => (prev === section ? null : prev))}
            onDrop={(e) => handleDrop(e, section)}
            className={cn(
              "flex flex-col transition-shadow",
              isHover && `ring-2 ${meta.ring}`,
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Icon className={`size-4 ${meta.tone}`} />
                <span>{meta.label}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {bucket.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-2">
              {bucket.length === 0 && (
                <div
                  className={cn(
                    "rounded-md border border-dashed bg-muted/20 p-4 text-center text-xs text-muted-foreground",
                    isHover && "border-primary text-primary",
                  )}
                >
                  {isHover ? "여기로 이동" : "항목 없음"}
                </div>
              )}
              {bucket.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "transition-opacity",
                    draggingId === item.id && "opacity-40",
                  )}
                >
                  <ItemCard
                    item={item}
                    applied={appliedIds.has(item.id)}
                    dismissed={dismissedIds.has(item.id)}
                    busy={busyItemId === item.id}
                    onApply={onApply}
                    onDismiss={onDismiss}
                    onDragStart={(it) => setDraggingId(it.id)}
                    onDragEnd={() => setDraggingId(null)}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
