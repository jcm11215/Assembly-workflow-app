/**
 * Salvages a very nearly valid JSON reply.
 *
 * A shop drawing is wall-to-wall inch marks and foot marks -- 12" DIA,
 * 20' LG, 2-7/16" BORE -- and a model transcribing them into JSON
 * strings gets the escaping wrong now and then. One misplaced backslash
 * at character 2,849 of an 7,700-character reply used to discard the
 * whole thing: every dimension, and the title block with it, thrown away
 * over a single character that a human reader would not even notice.
 *
 * So parse, and if that fails, repair the things models actually get
 * wrong and parse again. Each repair is conservative and local -- it
 * only ever removes a character JSON cannot accept, or closes a
 * structure the reply left open. Nothing here invents a value, and a
 * reply too broken to fix still comes back as a failure rather than as
 * a plausible-looking guess.
 */

/** Escapes JSON actually allows after a backslash inside a string. */
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * Walks the text once, tracking whether we are inside a string literal,
 * and fixes what it finds. Done as a single scan rather than regexes
 * because "inside a string" is the thing every rule depends on, and a
 * regex cannot know: a brace in "see detail {A} on sheet 2" is text.
 *
 * Also records a checkpoint at every point where a nested value has just
 * finished -- somewhere the reply could be cut and still be complete.
 * That is what lets a truncated parts list keep the entries that made it
 * without also keeping the half-written one after them.
 */
function scanAndFix(text){
  let out = '';
  let inString = false;
  const stack = [];               // the '{' and '[' still waiting to close
  const fixes = [];
  const checkpoints = [];         // {at, open} -- a clean cut point

  for(let i = 0; i < text.length; i++){
    const c = text[i];

    if(inString){
      if(c === '\\'){
        const next = text[i + 1];
        if(next === undefined){
          // A lone trailing backslash: cut off mid-escape.
          fixes.push('dropped a trailing backslash');
          continue;
        }
        if(VALID_ESCAPES.has(next)){
          // \u must be followed by four hex digits, or the parse fails on
          // the escape rather than on the character after it.
          if(next === 'u' && !/^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))){
            fixes.push('dropped a malformed \\u escape');
            i++;
            continue;
          }
          out += c + next;
          i++;
          continue;
        }
        // The common case: \' for a foot mark, or a backslash before a
        // space or a digit. Drop the backslash and keep the character --
        // it is what the drawing says, and what the model meant.
        fixes.push(`dropped an invalid escape \\${next}`);
        continue;
      }
      if(c === '"'){ inString = false; out += c; continue; }
      if(c === '\n' || c === '\r'){
        // A raw newline inside a string is illegal; the model meant a
        // line break in a description.
        fixes.push('escaped a raw newline inside a string');
        out += '\\n';
        continue;
      }
      if(c === '\t'){ fixes.push('escaped a raw tab inside a string'); out += '\\t'; continue; }
      out += c;
      continue;
    }

    if(c === '"'){ inString = true; out += c; continue; }
    if(c === '{' || c === '['){ stack.push(c); out += c; continue; }
    if(c === '}' || c === ']'){
      stack.pop();
      out += c;
      // A nested value just closed, so everything up to here is whole.
      if(stack.length) checkpoints.push({ at: out.length, open: stack.join('') });
      continue;
    }
    out += c;
  }

  const closers = open => [...open].reverse().map(b => (b === '{' ? '}' : ']')).join('');
  const tidy = t => t.replace(/,(\s*[}\]])/g, '$1');   // trailing commas

  if(!inString && !stack.length) return { text: tidy(out), fixes, truncated: false };

  // Truncated. Two different situations, and treating them the same is
  // what makes a salvage either lose good data or invent bad data:
  //
  //  - only structures left open: the last value finished, so closing
  //    them in place keeps everything the reply said.
  //  - a string left unterminated: the last value was cut mid-word, so
  //    closing in place would keep a fragment -- a part called "Bea" --
  //    as though the model had said it. Fall back to the last clean cut
  //    point and drop the fragment instead.
  if(inString && checkpoints.length){
    const cp = checkpoints[checkpoints.length - 1];
    fixes.push('the reply was cut off mid-value -- kept everything before it and dropped the fragment');
    return { text: tidy(out.slice(0, cp.at) + closers(cp.open)), fixes, truncated: true };
  }

  if(inString){ out += '"'; fixes.push('closed an unterminated string'); }
  if(stack.length){
    fixes.push(`closed ${stack.length} unfinished structure${stack.length === 1 ? '' : 's'} -- the reply was cut off`);
    out += closers(stack.join(''));
  }
  return { text: tidy(out), fixes, truncated: true };
}

/**
 * @returns {{parsed: object|null, repairs: string[]}} parsed is null only
 *          when the reply could not be salvaged at all. `repairs` lists
 *          what had to be changed, so a reply that needed fixing is
 *          visible in the diagnostics rather than passing silently.
 */
export function parseJsonLenient(raw){
  const text = String(raw == null ? '' : raw).trim()
    // Fences the model was asked not to add, and sometimes adds anyway.
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    .trim();
  if(!text) return { parsed: null, repairs: [], reason: 'the reply was empty' };

  try {
    return { parsed: JSON.parse(text), repairs: [] };
  } catch (first){
    const { text: fixed, fixes } = scanAndFix(text);
    if(fixed !== text){
      try {
        return { parsed: JSON.parse(fixed), repairs: fixes };
      } catch (second){
        return { parsed: null, repairs: fixes, reason: second.message };
      }
    }
    return { parsed: null, repairs: [], reason: first.message };
  }
}
