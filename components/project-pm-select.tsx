"use client"

import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { ProjectPmOption } from "@/lib/data"

interface ProjectPmSelectProps {
  value: string[]
  onChange: (value: string[]) => void
  options: ProjectPmOption[]
  unassignedValue: string
  id?: string
}

export function ProjectPmSelect({
  value,
  onChange,
  options,
  unassignedValue,
  id,
}: ProjectPmSelectProps) {
  const normalizedValue = Array.from(
    new Set(value.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  )
  const labelByEmail = new Map(options.map((option) => [option.email.trim().toLowerCase(), option.label]))
  const selectableValue = normalizedValue.filter((email) => labelByEmail.has(email))
  const selectedSet = new Set(selectableValue)
  const selectedLabels = selectableValue.map((email) => labelByEmail.get(email) || email)
  const selectedLabel =
    selectedLabels.length > 0 ? selectedLabels.join(", ") : "PM 미지정"

  const toggleEmail = (email: string) => {
    const normalizedEmail = email.trim().toLowerCase()
    const next = selectedSet.has(normalizedEmail)
      ? selectableValue.filter((item) => item !== normalizedEmail)
      : [...selectableValue, normalizedEmail]
    onChange(next)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="PM 이름 또는 이메일 검색" />
          <CommandList>
            <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={unassignedValue} onSelect={() => onChange([])}>
                <Check className={cn("h-4 w-4", selectableValue.length === 0 ? "opacity-100" : "opacity-0")} />
                <span>PM 미지정</span>
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={option.email}
                  value={`${option.label} ${option.email}`}
                  onSelect={() => toggleEmail(option.email)}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      selectedSet.has(option.email.trim().toLowerCase()) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="truncate text-[11px] text-muted-foreground">{option.email}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
