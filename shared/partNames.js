/**
 * The key a part's description is remembered under when someone corrects
 * a scanned part, used by the server when it learns and by the scan when
 * it looks the correction up: letters and digits only, one space between
 * words, upper case. "Flg. Brg 2-7/16" and "FLG BRG 2-7/16" are the same
 * part; a different size is a different key.
 */
export function learnKey(description){
  return String(description || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}
