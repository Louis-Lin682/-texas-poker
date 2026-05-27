export const DATE_CHIPS = [
  { label: '今日',  value: 'today'      },
  { label: '本週',  value: 'week'       },
  { label: '上週',  value: 'last-week'  },
  { label: '本月',  value: 'month'      },
  { label: '上月',  value: 'last-month' },
  { label: '全部',  value: 'all'        },
]

export function getPresetRange(value) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (value === 'today') {
    return { dateFrom: today.toISOString(), dateTo: null }
  }
  if (value === 'week') {
    const off = now.getDay() === 0 ? 6 : now.getDay() - 1
    return { dateFrom: new Date(today.getTime() - off * 86400_000).toISOString(), dateTo: null }
  }
  if (value === 'last-week') {
    const off = now.getDay() === 0 ? 6 : now.getDay() - 1
    const thisMonday = new Date(today.getTime() - off * 86400_000)
    const lastMonday = new Date(thisMonday.getTime() - 7 * 86400_000)
    return { dateFrom: lastMonday.toISOString(), dateTo: thisMonday.toISOString() }
  }
  if (value === 'month') {
    return { dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), dateTo: null }
  }
  if (value === 'last-month') {
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
      dateTo:   new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    }
  }
  return { dateFrom: null, dateTo: null }
}
