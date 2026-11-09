/** Convert a DB expense (amounts in cents) to the API shape (amounts in display units). */
export type ExpenseRow = { amount: number; splits?: { amount: number }[] } & Record<string, unknown>

export function expenseToApi<T extends ExpenseRow>(e: T) {
  return {
    ...e,
    amount: e.amount / 100,
    splits: e.splits?.map((s) => ({ ...s, amount: s.amount / 100 })),
  }
}
