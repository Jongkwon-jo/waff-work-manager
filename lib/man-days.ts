export function calculateManDaysBetweenDates(
  startDate: Date,
  endDate: Date,
  includeWeekends: boolean,
): number {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0

  const from = start <= end ? start : end
  const to = start <= end ? end : start

  let days = 0
  for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    const dayOfWeek = cursor.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    if (includeWeekends || !isWeekend) {
      days += 1
    }
  }

  return days
}
