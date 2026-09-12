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

export function buildSpecPrompt(includeJobFields, pageClassification){
  return `You are a mechanical engineer reading a CONVEYOR SHOP DRAWING SET. Every image provided is a page from ONE drawing set describing ONE machine -- general assembly, side view, top view, end view, section views, and detail sheets. Do NOT treat pages as separate machines. Cross-reference them into a single unified specification.

${pageGuideBlock(pageClassification)}YOUR ONLY JOB IS TO READ VALUES OFF THE DRAWING. You are not designing anything and not estimating anything visually.

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
  "components": [{"item": "<short name>", "item_as_drawn": "<the part's description EXACTLY as the drawing writes it, verbatim>", "specification": "<size/material/spec or \\"\\">", "quantity": <integer or null>, "installation_location": "drive_end"|"tail_end"|"trough"|"screw"|"hanger"|"other"|"unknown", "source_page": <page>, "source_callout": "<the exact text of the label/callout this came from, or \\"\\" if read from a table row with no label text>", "extraction_method": "bom_table"|"callout"|"detail_view"|"general_assembly"|"inferred", "confidence": <0..1>, "position": {"x": <0..1, fraction of the SOURCE PAGE image width, from the left edge>, "y": <0..1, fraction of that page's height, from the top edge>} or null}],
  "conflicts": [{"field": "<dimension name>", "detail": "<page X says A, page Y says B>"}],
  "notes": "<anything an assembler should know that the fields above don't capture, or \\"\\">"
}

For "installation_location", follow this exact two-pass procedure -- do not classify components one-by-one from isolated labels, since that is what causes drive/tail mixups on drawings that don't spell out "DRIVE END" or "TAIL END" verbatim.

PASS 1 -- Establish orientation from the general assembly view, once, before classifying anything:
Find the motor and/or gearbox/reducer. Wherever they are is the drive end -- this is true regardless of what that end is labeled (some drawings say "DRIVE END", others say "DISCHARGE", "HEAD END", "HE", or don't label it at all and only show the motor). The opposite end of the conveyor is the tail end (also seen labeled "INLET", "FOOT END", "TE", or unlabeled). Record which physical side (e.g. left/right, or by a datum/station number if the drawing uses one) is the drive end before doing anything else. Set drive.location and tail-end fields based on this pass.

PASS 2 -- Classify every component using the orientation from Pass 1, not its own isolated label:
A shaft, bearing, coupling, or sprocket physically located on the drive-end side (per Pass 1) is "drive_end", even if its own callout or detail-view title doesn't use that wording. Likewise for tail_end. A bearing along the open span between the two ends (not at either end) is "hanger". Only use "unknown" when the drawing genuinely does not show enough to place a component at either end or along the span -- not when the component simply lacks its own explicit label, since Pass 1's orientation should resolve most of those cases.

If a drawing has no motor/gearbox visible on any page (e.g. a driveless assembly, or the drive is on a separate sheet not provided), say so honestly in "notes" and mark drive-related fields not_found rather than guessing which end would have been the drive end.

COMPONENTS LIST -- every component carries TWO names, and they are not interchangeable:

- "item_as_drawn" is the shop's own wording, copied VERBATIM: the BOM/parts-table description cell for that row, or the callout text pointing at the part. Keep the drawing's abbreviations, punctuation, spacing and capitalization exactly as printed ("FLG BRG 2-7/16 BORE", "HNGR BRG ASSY", "GEARMOTOR, 3/4HP"). Do NOT tidy it up, expand abbreviations, re-order words, or drop the size out of it. This is what the assembler will be matching against the paper drawing in front of them, so it has to read identically. If a part genuinely has no written description anywhere (you inferred it from a picture alone), use "".
- "item" is the category name from the fixed list below, used to group and colour-code the part. This is the ONLY field you normalize.

ONLY include these part types, nothing else. Use the name shown as the start of "item" (put sizes and model numbers in "specification"):
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

Check EVERY page for these -- BOM tables, callouts, and detail views on any sheet. Do NOT include plates, weldments, sprockets, keys, guards, other fasteners, trough sections, covers, shrouds, or discharge spouts/chutes -- even if clearly visible and labeled on the drawing. This is a fixed whitelist, not a completeness target.

For each of those part types, still assign installation_location per the two-pass procedure above -- the drive, motor, and reducer are always drive_end. Augers, coupling shafts, and coupling bolts along the run of the conveyor are "screw"; hanger bearings are "hanger".

POSITION -- for each component, set "position" to where it visually sits on its own source_page, as a fraction of THAT page's image (0,0 is the top-left corner, 1,1 is the bottom-right corner) -- not the whole drawing set, and not a physical measurement. Only set it when you can actually see the component as a shape or callout marker on a general assembly, side, end, or detail view; set it to null when the component was read from a BOM/parts table row with no corresponding marked location on any view. Do not estimate a position from the item's name or typical layout -- an honest null is correct and expected for table-only entries.

For a SCREW conveyor, "belt"/"head"/"idlers" will be all not_found -- that is expected; leave them as not_found rather than omitting them. For a BELT conveyor, "trough"/"screw"/"hangers" will be not_found. Fill in whichever applies. (These "not_found" spec fields are separate from the components whitelist above -- the trough dimension fields should still be filled in when known, even though trough hardware itself is never a listed component.)`;
}

/* ---------------- Engineering validation ----------------
   Never silently corrects what the AI read -- it reports, so a value
   that failed a check is shown as failed rather than quietly replaced
   with a plausible-looking one. */
