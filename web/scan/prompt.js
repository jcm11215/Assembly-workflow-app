/**
 * Version stamps for each prompt, part of the cache key for the reading
 * it drives (scanStore.js).
 *
 * BUMP THE NUMBER WHENEVER YOU CHANGE THAT PROMPT'S WORDING. A stored
 * answer is an answer to the question as it was asked; serve it against
 * a reworded question and you get the worst kind of stale -- invisible,
 * confident, and to a question nobody asked any more. Bumping makes
 * every old entry miss, which is exactly right: they answer a question
 * that no longer exists.
 */
export const PROMPT_VERSIONS = {
  classify: 1,
  parts: 2,   // reads one sheet, or its enlarged table
  layout: 2,  // one sheet: the main view
  callouts: 4   // plus a hash of the item list and drive side it is asked with
};

/** Extraction prompts. The AI reads values off the drawing only; it
 *  never invents one, and never assigns a component's assembly stage --
 *  see installation_location below and stageForLocation() in spec.js. */

/**
 * Cheap preliminary call: classify each page's role before the main
 * extraction runs. Small, fast output (no dimensions, no components) --
 * its only job is to tell the main prompt where to look for what.
 */
export function buildPageClassificationPrompt(){
  return `You are looking at pages from a mechanical shop drawing set. For EACH page, classify which kind of page it is.

Respond with ONLY this JSON object, no markdown fences, no commentary:
{"pages": [{"page": 1, "view": "title_block"|"bom"|"general_assembly"|"side_view"|"end_view"|"detail_view"|"other"}]}

Definitions:
- title_block: the page (or corner of a page) with job number, customer, drawing number, revision -- classify the whole page this way only if that's the majority of its content.
- bom: a parts/hardware table with item, quantity, and/or spec columns.
- general_assembly: the main overall view showing the whole machine.
- side_view / end_view: an orthographic view from that direction.
- detail_view: a zoomed-in callout of one area (a bearing mount, a flange, etc).
- other: anything that doesn't fit the above (notes page, revision history, etc).

If a single page has multiple things on it (e.g. a general assembly view with a title block in the corner), classify it by whichever occupies most of the page. Return one entry per page, in page order, and nothing else.`;
}

/**
 * Which pages hold what, from the classification pass. The split matters
 * because the later passes each look at a subset: a parts table is read
 * off the BOM sheets, and balloons are only ever on a drawn view.
 *
 * Every list falls back to "all pages" when the classification didn't
 * name any, so an unclassifiable set degrades to the old behaviour of
 * looking everywhere rather than looking nowhere.
 */
export function pagesByRole(pageClassification, allPages){
  const pages = pageClassification && Array.isArray(pageClassification.pages)
    ? pageClassification.pages.filter(p => p && p.page != null) : [];
  const of = (...views) => pages.filter(p => views.includes(p.view)).map(p => Number(p.page));
  const orAll = list => list.length ? list : allPages.slice();
  return {
    bom: orAll(of('bom')),
    views: orAll(of('general_assembly', 'side_view', 'end_view', 'detail_view')),
    assembly: orAll(of('general_assembly', 'side_view')),
    titles: of('title_block'),
    all: allPages.slice()
  };
}

/**
 * PASS 2 of the scan: the parts list, and nothing else.
 *
 * Its own call, on the BOM sheets alone, because a parts table is a
 * reading task with a right answer -- and asking for it in the same
 * breath as sixty dimension objects and a set of screen coordinates is
 * what made it slow, truncation-prone and vague. No positions here: this
 * pass answers "what parts", the callout pass answers "where", and the
 * two are joined by item number in code rather than by the model.
 *
 * The title-block fields are asked for here AND in the layout question,
 * on purpose: they are what a new job's form is prefilled from, and two
 * cheap readings of the same corner of the sheet mean one bad reply
 * doesn't cost the job number. Whichever survives is used.
 */
export function buildPartsListPrompt(includeJobFields){
  return `You are a mechanical engineer reading the PARTS LIST (BOM) of a conveyor shop drawing set. The images are pages from ONE drawing set describing ONE machine.

Your only task on this pass is to transcribe the parts table${includeJobFields ? ', plus the few identifying fields from the title block' : ''}. Do NOT report dimensions. Do NOT report screen positions. Another pass handles those.

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
  "drawing_number": "<from the title block, or \\"\\">",
${includeJobFields ? '  "jobNumber": "<the job/order number from the title block, or \\"\\">",\n  "customer": "<the customer name from the title block, or \\"\\">",\n  "description": "<the one-line equipment description from the title block>",' : ''}
  "parts": [{
    "balloon": <the ITEM/FIND number printed in the table's first column, as an integer, or null if the table has no item numbers>,
    "item": "<the category name from the fixed list below>",
    "item_as_drawn": "<the description cell EXACTLY as printed, verbatim>",
    "part_number": "<the part/stock number cell, or \\"\\">",
    "specification": "<size/material/spec, or \\"\\">",
    "quantity": <integer or null>,
    "installation_location": "drive_end"|"tail_end"|"trough"|"screw"|"hanger"|"other"|"unknown",
    "source_page": <1-based page number the row was read from>,
    "extraction_method": "bom_table"|"callout"|"detail_view"|"general_assembly"|"inferred",
    "confidence": <0..1>
  }]
}

THE TWO NAMES ARE NOT INTERCHANGEABLE:
- "item_as_drawn" is the shop's own wording, copied VERBATIM from the description cell. Keep its abbreviations, punctuation, spacing and capitalization exactly as printed ("FLG BRG 2-7/16 BORE", "HNGR BRG ASSY", "GEARMOTOR, 3/4HP"). Do NOT tidy it up, expand abbreviations, re-order words, or drop the size out of it. The assembler matches this against the paper drawing in front of them, so it has to read identically. Use "" only if the part has no written description anywhere.
- "item" is the category name from the fixed list, used to group and colour-code the part. It is the ONLY field you normalize.

"balloon" is the number that ties this row to a balloon marker on the drawn views. Copy it exactly as the table prints it -- it is the join key for the next pass, so a wrong number puts a label on the wrong part. If the row has no item number, use null.

ONLY include these part types, nothing else. Use the name shown as the start of "item" (sizes and model numbers go in "specification"):
- Drive (the drive unit itself, e.g. a shaft-mount or screw conveyor drive)
- Motor
- Reducer (gearbox)
- Seal (including waste pack seals and flange glands)
- Gasket
- Bearing (end bearings, flange bearings, pillow blocks)
- Hanger Bearing (hangers and bearings along the trough span)
- Coupling Shaft
- Tail Shaft
- Drive Shaft
- Auger (screw/flighting sections)
- Coupling Bolts
- UHMW (liners, wear strips, or other UHMW parts)

Do NOT include plates, weldments, sprockets, keys, guards, other fasteners, trough sections, covers, shrouds, or discharge spouts/chutes -- even if clearly listed. This is a fixed whitelist, not a completeness target. Check every page given to you: a set can carry its parts table across more than one sheet.

For "installation_location": the drive, motor and reducer are always "drive_end". Hanger bearings are "hanger". Augers, coupling shafts and coupling bolts along the run are "screw". Where the table alone doesn't say which end a shaft or bearing belongs to, use "unknown" -- do not guess. A later pass sees the assembly view and can place it.

Return an empty "parts" array if these pages carry no parts table at all. An honest empty answer is correct and useful; an invented row is a defect.`;
}

/**
 * The layout question, asked alongside the parts list: which end of the
 * machine is the drive end, and -- for a new job -- the title block.
 *
 * It used to ride on a long "read every dimension" reading, of which
 * only this answer was ever used. Asked on its own it is a few words in
 * and a few words out.
 */
const TITLE_FIELDS = [
  '  "jobNumber": "<the job/order number from the title block, or \\"\\">",',
  '  "customer": "<the customer name from the title block, or \\"\\">",',
  '  "description": "<the one-line equipment description from the title block, or \\"\\">",',
  '  "drawing_number": "<or \\"\\">",',
  ''
].join('\n');

export function buildLayoutPrompt(includeJobFields){
  return `You are looking at a conveyor shop drawing: its general assembly view${includeJobFields ? ' and title block' : ''}.

Answer ONE question${includeJobFields ? ', plus the title block' : ''}: which side of the assembly view is the DRIVE END?

The drive end is wherever the motor, gearmotor, reducer or drive unit is -- whatever that end is labeled ("DRIVE END", "HEAD END", "DISCHARGE", "HE", or nothing). The opposite end is the tail end ("TAIL", "INLET", "FOOT", "TE").

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
${includeJobFields ? TITLE_FIELDS : ''}  "orientation": {"drive_end_side": "left"|"right"|"top"|"bottom"|"unknown", "detail": "<what told you, e.g. \\"gearmotor drawn at the right end\\">"}
}

If no motor or drive is drawn, say "unknown". Do not guess.`;
}

/**
 * The balloon search, asked AFTER the parts list, about exactly the item
 * numbers the table has.
 *
 * "Find balloons 3, 7 and 11" is a far easier task than "report every
 * balloon", and it gets the drive side from the layout question, so for
 * each occurrence it can also say which end of the machine it is on --
 * a judgement about the picture, which the model makes far better than
 * a rule about page coordinates.
 *
 * @param items     [{balloon, item_as_drawn, quantity}] from the parts table
 * @param driveSide the layout answer, or "unknown"
 */
export function buildCalloutPrompt(items = [], driveSide = 'unknown'){
  const list = items.filter(i => i.balloon != null)
    .map(i => `- ${i.balloon}: ${String(i.item_as_drawn || i.item || '').slice(0, 60)}${Number(i.quantity) > 1 ? ` (QTY ${i.quantity})` : ''}`).join('\n');
  const ends = driveSide && driveSide !== 'unknown'
    ? `The drive end of this conveyor is on the ${driveSide.toUpperCase()} of the assembly view; the tail end is the opposite side.`
    : 'Which end is the drive end was not determined: the drive end is wherever the motor/reducer is drawn.';
  return `You are reading the DRAWN VIEWS of a conveyor shop drawing. The images are pages from ONE drawing set describing ONE machine.

A BALLOON CALLOUT is a small circle (or hexagon) containing an item number, with a leader line running to the component it names.

${list ? `The parts table lists these item numbers. Find the balloons for THESE numbers only:
${list}` : 'The parts table had no item numbers. Report the balloons you can read.'}

${ends}

For every balloon you find, report where its leader POINTS (the component, not the circle) and which part of the machine that component is on.

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
  "callouts": [{
    "balloon": <the number in the balloon, as an integer>,
    "source_page": <1-based page number>,
    "position": {"x": <0..1>, "y": <0..1>},
    "end": "drive_end"|"tail_end"|"along_run"|"unknown",
    "confidence": <0..1>
  }],
  "unballooned": [{
    "label": "<text callout naming a part, verbatim>",
    "source_page": <page>,
    "position": {"x": <0..1>, "y": <0..1>},
    "end": "drive_end"|"tail_end"|"along_run"|"unknown",
    "confidence": <0..1>
  }]
}

"position" is a fraction of THAT page's image: 0,0 top-left, 1,1 bottom-right.
"end": drive_end or tail_end for a component at that end of the conveyor (end plates, end bearings, seals, shafts there); along_run for anything in the span between (hangers, flighting, coupling shafts); unknown if you cannot tell.

Report each item number ONCE PER END of the machine it is drawn at, however many views show it: a bearing ballooned "5" at both ends is two entries, one drive_end and one tail_end; a motor ballooned in two views is one entry. An item with a QTY above 1 is often ballooned only once even though one is drawn at each end: report it at each end where you can see it, with the same number, even where that end has no balloon of its own. Parts that run along the conveyor (flights, hangers, coupling shafts and bolts) are ONE entry, end along_run, however many of them there are. Leave out a balloon whose number you cannot read rather than guessing it -- a wrong number labels the wrong part. "unballooned" is only for plain text callouts with a leader and no number.`;
}

/* ---------------- Engineering validation ----------------
   Never silently corrects what the AI read -- it reports, so a value
   that failed a check is shown as failed rather than quietly replaced
   with a plausible-looking one. */
