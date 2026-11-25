// Pomades the shop sells at the desk. Names, hold, finish and prices are placeholders
// until the owner gives the real list.
// price_centavos: whole centavos like the rest of the app (35000 = P350.00), or null to show "Ask at the desk".

export type Product = {
  name: string
  /** how strong it holds, e.g. "Medium hold" */
  hold: string | null
  /** how it looks, e.g. "Matte" or "High shine" */
  finish: string | null
  price_centavos: number | null
}

export const PRODUCTS: Product[] = [
  { name: '[Pomade name]', hold: '[Hold]', finish: '[Finish]', price_centavos: null },
  { name: '[Pomade name]', hold: '[Hold]', finish: '[Finish]', price_centavos: null },
  { name: '[Pomade name]', hold: '[Hold]', finish: '[Finish]', price_centavos: null },
  { name: '[Pomade name]', hold: '[Hold]', finish: '[Finish]', price_centavos: null },
]
