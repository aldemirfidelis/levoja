/** Utilitários sem estado, seguros para Server Components. */
export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');
