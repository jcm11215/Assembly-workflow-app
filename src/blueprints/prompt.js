/** Extraction prompts. AI reads values only; it never produces geometry
 *  and, as of Phase 8, never assigns a component's assembly stage --
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
  "components": [{"item": "<short name>", "specification": "<size/material/spec or \\"\\">", "quantity": <integer or null>, "installation_location": "drive_end"|"tail_end"|"trough"|"screw"|"hanger"|"other"|"unknown", "source_page": <page>, "source_callout": "<the exact text of the label/callout this came from, or \\"\\" if read from a table row with no label text>", "extraction_method": "bom_table"|"callout"|"detail_view"|"general_assembly"|"inferred", "confidence": <0..1>}],
  "conflicts": [{"field": "<dimension name>", "detail": "<page X says A, page Y says B>"}],
  "notes": "<anything an assembler should know that the fields above don't capture, or \\"\\">"
}

For "installation_location": report ONLY where the drawing shows the part installing -- do not infer a general category, and do not guess between drive_end and tail_end if the drawing does not make it clear which end a bearing or shaft belongs to; use "unknown" rather than guessing. A shaft or bearing shown in a detail view keyed to the drive-end callout is "drive_end"; one keyed to the tail-end callout is "tail_end"; a hanger bearing along the trough span is "hanger", not drive_end or tail_end.

For a SCREW conveyor, "belt"/"head"/"idlers" will be all not_found -- that is expected; leave them as not_found rather than omitting them. For a BELT conveyor, "trough"/"screw"/"hangers" will be not_found. Fill in whichever applies.`;
}

/* ---------------- Engineering validation ----------------
   Runs before any geometry is built. Never silently corrects -- it
   reports, and the geometry generator then refuses to invent anything
   that failed. */
