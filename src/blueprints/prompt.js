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

/** Turns a classification result into targeted instructions injected into
 *  the main prompt -- this is the "specialized prompt per page type"
 *  requirement, implemented as page-role-aware guidance within one
 *  cross-referencing call rather than N isolated per-page calls, which
 *  would lose the ability to reconcile a dimension on one page against
 *  a label on another. */
function pageGuideBlock(pageClassification){
  const pages = pageClassification && Array.isArray(pageClassification.pages)
    ? pageClassification.pages : null;
  if(!pages || !pages.length) return '';

  const roleHint = {
    title_block: 'read job number, customer, and description here first.',
    bom: 'prefer this table for item/specification/quantity over inferring from views -- mark extraction_method "bom_table" for anything read here.',
    general_assembly: 'read overall dimensions and use this to confirm which components are drive-end vs tail-end.',
    side_view: 'cross-check incline angle and overall length here.',
    end_view: 'cross-check trough width/diameter and frame width here.',
    detail_view: 'read precise bearing bore, shaft diameter, and other close-tolerance dimensions here -- mark extraction_method "detail_view".',
    other: null
  };
  const lines = pages
    .filter(p => p && p.page != null && roleHint[p.view])
    .map(p => `- Page ${p.page} (${p.view}): ${roleHint[p.view]}`);
  if(!lines.length) return '';

  return `PAGE GUIDE (from a preliminary classification pass -- use this to prioritize where to look, but still cross-reference every page):
${lines.join('\n')}

`;
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
 */
export function buildPartsListPrompt(){
  return `You are a mechanical engineer reading the PARTS LIST (BOM) of a conveyor shop drawing set. The images are pages from ONE drawing set describing ONE machine.

Your only task on this pass is to transcribe the parts table. Do NOT report dimensions. Do NOT report screen positions. Another pass handles those.

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
  "drawing_number": "<from the title block, or \\"\\">",
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
 * PASS 3 of the scan: where the balloons are, and nothing else.
 *
 * The output is numbers and coordinates -- no prose, no descriptions --
 * so it is short, fast, and hard to get creatively wrong. The point of
 * reading balloons rather than hunting for the parts themselves is that
 * a balloon is a mark the draftsman placed deliberately, with a leader
 * already pointing at the exact component: the drawing has done the
 * locating for us, and we only have to read it.
 */
export function buildCalloutPrompt(){
  return `You are reading the DRAWN VIEWS of a conveyor shop drawing set -- the general assembly and any side/end/detail views. The images are pages from ONE drawing set describing ONE machine.

Your only task on this pass is to say WHERE things are on the page. Do NOT transcribe the parts table. Do NOT report dimensions. Another pass handles those.

A BALLOON CALLOUT is a small circle (or hexagon) containing an item number, with a leader line running from it to the component it names. Find every balloon attached to an assembly view, read its number, and report where its leader POINTS -- not where the balloon circle itself sits.

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
  "callouts": [{
    "balloon": <the number inside the balloon, as an integer>,
    "source_page": <1-based page number this balloon is on>,
    "label": "<any text printed next to the balloon or on its leader, verbatim, or \\"\\">",
    "position": {"x": <0..1>, "y": <0..1>},
    "bbox": [<x>, <y>, <w>, <h>],
    "confidence": <0..1>
  }],
  "unballooned": [{
    "label": "<the callout text naming this part, verbatim>",
    "source_page": <page>,
    "position": {"x": <0..1>, "y": <0..1>},
    "bbox": [<x>, <y>, <w>, <h>],
    "confidence": <0..1>
  }]
}

COORDINATES: "position" is the point the leader arrow touches -- the component itself. "bbox" is [x, y, width, height] enclosing that component. All four numbers, and both of position's, are fractions of THAT page's image: 0,0 is the top-left corner and 1,1 is the bottom-right. They are not physical measurements, and not fractions of the drawing set.

Report a balloon ONCE PER OCCURRENCE. Four hanger bearings balloon-numbered 7 means four entries with "balloon": 7 and four different positions -- one per location on the machine. Do not collapse them into one, and do not report a balloon you cannot actually see a marker for.

"unballooned" is for a component named by a plain text callout with a leader but no numbered balloon, and for a component you can clearly identify as a shape on the view with no callout at all. Put the drawing's own wording in "label" when there is any; leave it "" when you identified the part from its shape. These are matched up by name later, so the wording matters.

Set "confidence" low when a balloon's number is hard to read or its leader is ambiguous about which component it lands on. Leave a balloon out entirely rather than guessing its number: a mis-read number puts a label on the wrong part, which is worse than a part going unlabeled. An empty "callouts" array is a correct answer for a view that carries no balloons.`;
}

/**
 * PASS 4 of the scan: the engineering dimensions, and nothing else.
 *
 * This is the long one -- sixty-odd dimension objects, cross-referenced
 * across every sheet -- so the parts list and the callout positions were
 * lifted out of it into their own passes. It used to carry all three,
 * which is what made a scan slow and put its reply close enough to the
 * output limit that a truncation came back as zero parts.
 */
export function buildSpecPrompt(includeJobFields, pageClassification){
  return `You are a mechanical engineer reading a CONVEYOR SHOP DRAWING SET. Every image provided is a page from ONE drawing set describing ONE machine -- general assembly, side view, top view, end view, section views, and detail sheets. Do NOT treat pages as separate machines. Cross-reference them into a single unified specification.

${pageGuideBlock(pageClassification)}YOUR ONLY JOB ON THIS PASS IS TO READ DIMENSIONS OFF THE DRAWING. You are not designing anything and not estimating anything visually. Separate passes handle the parts list and the on-page location of each part -- do NOT return either here.

RULES -- these matter more than completeness:
1. Prefer explicit dimension callouts and dimension/BOM tables. Then detail views. Then known component sizes. Use drawing scale ONLY as a last resort and mark it "inferred".
2. NEVER measure pixels and report the result as an engineering dimension when an explicit callout exists anywhere in the set.
3. If a value is not determinable, return {"value": null, "confidence": 0, "status": "not_found"}. DO NOT GUESS. A missing value is correct and useful; an invented one is a defect.
4. If two pages disagree, record BOTH in "conflicts" rather than picking one.
5. Do not report components that are not shown on the drawing.

EVERY dimension must be an object of this exact form:
{"value": <number>, "unit": "in"|"ft"|"mm"|"cm"|"m", "source_page": <1-based page number>, "source": "<which callout/table/view it came from>", "description": "<what it measures>", "confidence": <0..1>, "method": "direct"|"inferred", "status": "ok"}
or, when absent: {"value": null, "confidence": 0, "status": "not_found"}

Respond with ONLY this JSON object, no markdown fences, no commentary:
{
${includeJobFields ? '  "jobNumber": "<from title block, or \\"\\">",\n  "customer": "<from title block, or \\"\\">",\n  "description": "<one-line equipment description from the title block>",\n' : ''}  "conveyorType": "screw" | "belt",
  "pages_analyzed": [{"page": 1, "view": "general assembly|side view|top view|end view|section|detail|BOM|title block|other"}],
  "overall": {
    "overall_length": {...}, "overall_width": {...}, "overall_height": {...},
    "elevation": {...}, "incline_angle": {...}, "centerline_height": {...}
  },
  "trough": { "trough_width": {...}, "trough_depth": {...}, "trough_gauge": {...}, "flange_height": {...}, "material": "<or null>", "style": "<U-trough|tubular|flared|null>" },
  "screw": { "screw_diameter": {...}, "screw_pitch": {...}, "shaft_diameter": {...}, "shaft_length": {...}, "flight_thickness": {...}, "shaftless": true|false, "hand": "<right|left|null>" },
  "hangers": { "count": <integer or null>, "hanger_spacing": {...}, "bearing_type": "<or null>", "bearing_bore": {...}, "positions_in": [<distances from tail end, if callouts give them>] },
  "drive": { "location": "<head|tail|null>", "motor_hp": "<or null>", "gearbox": "<or null>", "sprocket_diameter": {...}, "shaft_diameter": {...}, "bearing_type": "<or null>", "bearing_bore": {...}, "guard": true|false },
  "tail": { "shaft_diameter": {...}, "shaft_length": {...}, "bearing_type": "<or null>", "bearing_bore": {...}, "take_up_travel": {...} },
  "inlets_outlets": [{"type": "inlet|outlet", "position_in": <distance from tail end or null>, "inlet_length": {...}, "outlet_length": {...}}],
  "frame": { "frame_height": {...}, "frame_width": {...}, "side_rail_height": {...}, "side_rail_thickness": {...}, "leg_spacing": {...}, "leg_positions_in": [<distances from tail end>], "supports": "<description or null>" },
  "belt": { "belt_width": {...}, "belt_thickness": {...} },
  "head": { "pulley": {"pulley_diameter": {...}, "pulley_width": {...}}, "shaft_diameter": {...}, "bearing_bore": {...} },
  "idlers": { "roller_diameter": {...}, "roller_width": {...}, "roller_spacing": {...}, "count": <integer or null> },
  "orientation": {"drive_end_side": "<left|right|top|bottom|unknown>", "detail": "<what told you -- e.g. \\"gearmotor shown at the left end of the GA view on page 2\\">"},
  "conflicts": [{"field": "<dimension name>", "detail": "<page X says A, page Y says B>"}],
  "notes": "<anything an assembler should know that the fields above don't capture, or \\"\\">"
}

ORIENTATION -- establish which end is the drive end once, from the general assembly view, before filling in any drive-end or tail-end field:

Find the motor and/or gearbox/reducer. Wherever they are is the drive end -- this is true regardless of what that end is labeled (some drawings say "DRIVE END", others say "DISCHARGE", "HEAD END", "HE", or don't label it at all and only show the motor). The opposite end of the conveyor is the tail end (also seen labeled "INLET", "FOOT END", "TE", or unlabeled). Report which physical side this is in "orientation.drive_end_side", and set drive.location and the drive/tail dimension groups from it. A later pass uses your answer to place parts whose own table row doesn't say which end they belong to, so it is worth getting right even though no dimension depends on it.

If no motor/gearbox is visible on any page (a driveless assembly, or the drive is on a separate sheet not provided), set orientation.drive_end_side to "unknown", say so honestly in "notes", and mark drive-related fields not_found rather than guessing which end would have been the drive end.

For a SCREW conveyor, "belt"/"head"/"idlers" will be all not_found -- that is expected; leave them as not_found rather than omitting them. For a BELT conveyor, "trough"/"screw"/"hangers" will be not_found. Fill in whichever applies.`;
}

/* ---------------- Engineering validation ----------------
   Never silently corrects what the AI read -- it reports, so a value
   that failed a check is shown as failed rather than quietly replaced
   with a plausible-looking one. */
