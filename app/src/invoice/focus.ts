/** Ask for a field by its key once the render that creates it has landed. */
export function focusSoon(key: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-inv-focus="${CSS.escape(key)}"]`)
    el?.focus()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select()
  })
}
