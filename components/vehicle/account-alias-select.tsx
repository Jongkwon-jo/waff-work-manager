"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type AccountAliasOption = {
  email: string
  alias: string
}

function optionLabel(option: AccountAliasOption) {
  return option.alias.trim() || option.email
}

function AliasToken({ option }: { option: AccountAliasOption }) {
  return (
    <span className="max-w-[86px] truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
      {optionLabel(option)}
    </span>
  )
}

function OptionText({ option }: { option: AccountAliasOption }) {
  const label = optionLabel(option)
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{label}</span>
      {label !== option.email && <span className="block truncate text-[10px] text-muted-foreground">{option.email}</span>}
    </span>
  )
}

export function AccountAliasSelect({
  value,
  options,
  onChange,
  className,
  placeholder = "운전자 선택",
}: {
  value: string
  options: AccountAliasOption[]
  onChange: (email: string) => void
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.email === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-8 justify-between bg-white px-2 text-xs font-normal", className)}>
          {selected ? <AliasToken option={selected} /> : <span className="truncate text-muted-foreground">{placeholder}</span>}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
        <div className="max-h-64 space-y-1 overflow-auto pr-1">
          {options.map((option) => (
            <button
              key={option.email}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => {
                onChange(option.email)
                setOpen(false)
              }}
            >
              <OptionText option={option} />
              {option.email === value && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AccountAliasMultiSelect({
  value,
  options,
  onChange,
  className,
  placeholder = "탑승자 선택",
}: {
  value: string[]
  options: AccountAliasOption[]
  onChange: (emails: string[]) => void
  className?: string
  placeholder?: string
}) {
  const selectedOptions = useMemo(
    () => value.map((email) => options.find((option) => option.email === email)).filter((option): option is AccountAliasOption => Boolean(option)),
    [options, value],
  )
  const selectedSet = useMemo(() => new Set(value), [value])

  const toggle = (email: string) => {
    const next = new Set(value)
    if (next.has(email)) next.delete(email)
    else next.add(email)
    onChange(Array.from(next))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={cn("h-8 justify-between bg-white px-2 text-xs font-normal", className)}>
          {selectedOptions.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              <AliasToken option={selectedOptions[0]} />
              {selectedOptions.length > 1 && <span className="shrink-0 text-[10px] text-muted-foreground">+{selectedOptions.length - 1}</span>}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
        <div className="max-h-64 space-y-1 overflow-auto pr-1">
          {options.map((option) => (
            <button
              key={option.email}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => toggle(option.email)}
            >
              <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", selectedSet.has(option.email) && "border-primary bg-primary text-primary-foreground")}>
                {selectedSet.has(option.email) && <Check className="h-3 w-3" />}
              </span>
              <OptionText option={option} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
