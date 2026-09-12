// Geometry for the job page's callout diagram: numbered balloons on the
// drawing with leader lines out to labels in the gutters. The failure
// modes worth pinning down are overlapping labels, leader lines dragged
// across the whole sheet, and numbering that doesn't match how a person
// reads a drawing.
const { layoutCallouts, frameForParts, pointInFrame, frameImageStyle,
        GUTTER, IMAGE_LEFT, IMAGE_WIDTH, MIN_LABEL_GAP } =
  await import('../src/blueprints/calloutLayout.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const at = (x, y, item) => ({ item: item || 'Part', position: { x, y } });

console.log('=== sides: a part is labelled on its own side of the drawing ===');
{
  const { callouts } = layoutCallouts([at(0.1, 0.5, 'Tail'), at(0.9, 0.5, 'Drive')]);
  const tail = callouts.find(c => c.component.item === 'Tail');
  const drive = callouts.find(c => c.component.item === 'Drive');
  t('left-hand part gets a left-hand label', () => {
    if (tail.side !== 'left') throw new Error('got ' + tail.side);
  });
  t('right-hand part gets a right-hand label', () => {
    if (drive.side !== 'right') throw new Error('got ' + drive.side);
  });
  t('a leader line never crosses the drawing to reach its label', () => {
    for (const c of callouts) {
      const crosses = c.side === 'left' ? c.anchorX > c.pointX : c.anchorX < c.pointX;
      if (crosses) throw new Error(`${c.component.item} anchor ${c.anchorX} vs point ${c.pointX}`);
    }
  });
}

console.log('\n=== labels never overlap, however many land on one side ===');
for (const n of [2, 5, 12, 30]) {
  t(`${n} parts stacked on the same side stay ${MIN_LABEL_GAP}% apart`, () => {
    const comps = Array.from({ length: n }, (_, i) => at(0.2, (i + 0.5) / n, 'P' + i));
    const { callouts } = layoutCallouts(comps);
    const ys = callouts.map(c => c.labelY).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      const gap = ys[i] - ys[i - 1];
      if (gap < MIN_LABEL_GAP - 1e-9) throw new Error(`gap ${gap.toFixed(2)} at ${i}`);
    }
  });
}

console.log('\n=== label order follows the parts down the sheet ===');
t('labels on a side keep the parts\' top-to-bottom order', () => {
  const { callouts } = layoutCallouts([
    at(0.2, 0.9, 'bottom'), at(0.2, 0.1, 'top'), at(0.2, 0.5, 'middle')
  ]);
  const bySide = callouts.filter(c => c.side === 'left').sort((a, b) => a.labelY - b.labelY);
  const order = bySide.map(c => c.component.item).join(',');
  if (order !== 'top,middle,bottom') throw new Error('got ' + order);
});

console.log('\n=== numbering reads like a drawing: left-to-right, top-to-bottom ===');
t('same row numbers left to right', () => {
  const { callouts } = layoutCallouts([at(0.8, 0.20, 'right'), at(0.2, 0.22, 'left')]);
  const n = Object.fromEntries(callouts.map(c => [c.component.item, c.number]));
  if (n.left !== 1 || n.right !== 2) throw new Error(JSON.stringify(n));
});
t('a clearly lower part numbers after a higher one, whatever its x', () => {
  const { callouts } = layoutCallouts([at(0.1, 0.80, 'low'), at(0.9, 0.10, 'high')]);
  const n = Object.fromEntries(callouts.map(c => [c.component.item, c.number]));
  if (n.high !== 1 || n.low !== 2) throw new Error(JSON.stringify(n));
});
t('a run of parts at the same height numbers straight across, left to right', () => {
  // The case that matters on a real drawing: a conveyor elevation puts
  // almost every part at nearly the same height, with only millimetres of
  // y between them. Ordering must still read across the sheet, not jump
  // around it -- which is what a non-transitive "close enough" comparator
  // produces, since the sort result then depends on input order.
  const run = [
    { item: 'tail',   position: { x: 0.17, y: 0.545 } },
    { item: 'hanger', position: { x: 0.35, y: 0.500 } },
    { item: 'auger',  position: { x: 0.46, y: 0.455 } },
    { item: 'cplg',   position: { x: 0.62, y: 0.545 } },
    { item: 'drive',  position: { x: 0.87, y: 0.400 } }
  ];
  const expected = 'tail,hanger,auger,cplg,drive';
  // Any input order must give the same answer; a cyclic comparator won't.
  for (const perm of [run, [...run].reverse(), [run[2], run[4], run[0], run[3], run[1]]]) {
    const order = layoutCallouts(perm).callouts
      .sort((a, b) => a.number - b.number).map(c => c.component.item).join(',');
    if (order !== expected) throw new Error('got ' + order);
  }
});
t('numbers are 1..n with no gaps or repeats', () => {
  const comps = Array.from({ length: 9 }, (_, i) => at((i % 3) / 3 + 0.1, Math.floor(i / 3) / 3 + 0.1, 'P' + i));
  const nums = layoutCallouts(comps).callouts.map(c => c.number).sort((a, b) => a - b);
  if (nums.join(',') !== '1,2,3,4,5,6,7,8,9') throw new Error(nums.join(','));
});

console.log('\n=== points land on the drawing, not in the gutters ===');
t('a part at the drawing\'s left edge maps to the image band, not x=0', () => {
  const { callouts } = layoutCallouts([at(0, 0.5)]);
  if (Math.abs(callouts[0].pointX - IMAGE_LEFT) > 1e-9) throw new Error('got ' + callouts[0].pointX);
});
t('a part at the right edge maps to the far side of the image band', () => {
  const { callouts } = layoutCallouts([at(1, 0.5)]);
  if (Math.abs(callouts[0].pointX - (IMAGE_LEFT + IMAGE_WIDTH)) > 1e-9) throw new Error('got ' + callouts[0].pointX);
});
t('every point stays within the image band', () => {
  const comps = Array.from({ length: 20 }, (_, i) => at(i / 19, (i % 5) / 5));
  for (const c of layoutCallouts(comps).callouts) {
    if (c.pointX < IMAGE_LEFT - 1e-9 || c.pointX > IMAGE_LEFT + IMAGE_WIDTH + 1e-9) {
      throw new Error('pointX ' + c.pointX + ' outside band');
    }
  }
});
t('the image band leaves a gutter on both sides', () => {
  const { image } = layoutCallouts([at(0.5, 0.5)]);
  if (image.left !== GUTTER || image.width !== 100 - GUTTER * 2) throw new Error(JSON.stringify(image));
});

console.log('\n=== degenerate input ===');
t('no components -> no callouts, no crash', () => {
  if (layoutCallouts([]).callouts.length !== 0) throw new Error('expected none');
});
t('null/undefined input is tolerated', () => {
  if (layoutCallouts(null).callouts.length !== 0) throw new Error('expected none');
  if (layoutCallouts(undefined).callouts.length !== 0) throw new Error('expected none');
});
t('components without a position are ignored, not placed at 0,0', () => {
  const { callouts } = layoutCallouts([at(0.3, 0.3, 'placed'), { item: 'unplaced' }, { item: 'null', position: null }]);
  if (callouts.length !== 1 || callouts[0].component.item !== 'placed') throw new Error('got ' + callouts.length);
});
t('a single part is centred vertically', () => {
  const { callouts } = layoutCallouts([at(0.3, 0.9)]);
  if (callouts[0].labelY !== 50) throw new Error('got ' + callouts[0].labelY);
});
t('layout does not leave scratch fields on the caller\'s components', () => {
  const comps = [at(0.2, 0.2), at(0.8, 0.8)];
  layoutCallouts(comps);
  for (const c of comps) {
    const extra = Object.keys(c).filter(k => k !== 'item' && k !== 'position');
    if (extra.length) throw new Error('mutated input with: ' + extra.join(','));
  }
});

console.log('\n=== framing: crop the sheet down to the machine ===');
// A conveyor elevation: parts strung left to right across the middle of a
// sheet that is mostly border, title block and notes.
const conveyor = [
  at(0.115, 0.625), at(0.175, 0.545), at(0.345, 0.500), at(0.455, 0.455),
  at(0.545, 0.500), at(0.735, 0.615), at(0.865, 0.400)
];
t('the frame contains every part', () => {
  const f = frameForParts(conveyor);
  for (const c of conveyor) {
    if (c.position.x < f.x || c.position.x > f.x + f.w) throw new Error('x outside frame');
    if (c.position.y < f.y || c.position.y > f.y + f.h) throw new Error('y outside frame');
  }
});
t('it pads out past the outermost parts -- the machine runs past them', () => {
  const f = frameForParts(conveyor);
  if (f.x >= 0.115 || f.x + f.w <= 0.865) throw new Error('frame is tighter than the parts');
});
t('it actually crops something worth cropping', () => {
  const f = frameForParts(conveyor);
  if (f.h > 0.6) throw new Error('barely cropped vertically: h=' + f.h);
});
t('it never runs off the sheet', () => {
  for (const set of [conveyor, [at(0, 0), at(1, 1)], [at(0.02, 0.98), at(0.05, 0.95)]]) {
    const f = frameForParts(set);
    if (!f) continue;
    if (f.x < 0 || f.y < 0 || f.x + f.w > 1 + 1e-9 || f.y + f.h > 1 + 1e-9) {
      throw new Error(JSON.stringify(f));
    }
  }
});
t('two parts close together do not zoom to a postage stamp', () => {
  const f = frameForParts([at(0.50, 0.50), at(0.52, 0.51)]);
  if (f.w < 0.29 || f.h < 0.21) throw new Error('zoomed too far: ' + JSON.stringify(f));
});
t('parts already spanning the sheet are left uncropped', () => {
  if (frameForParts([at(0.02, 0.02), at(0.5, 0.5), at(0.98, 0.98)]) !== null) {
    throw new Error('cropped when there was nothing to crop away');
  }
});
t('a single part locates nothing, so nothing is cropped', () => {
  if (frameForParts([at(0.5, 0.5)]) !== null) throw new Error('cropped off one point');
});
t('no parts -> no frame', () => {
  if (frameForParts([]) !== null || frameForParts(null) !== null) throw new Error('expected null');
});

console.log('\n=== framing: parts are placed within the crop, not the page ===');
t('a part at the frame\'s corners maps to that corner of the view', () => {
  const f = { x: 0.2, y: 0.1, w: 0.6, h: 0.4 };
  const tl = pointInFrame({ x: 0.2, y: 0.1 }, f);
  const br = pointInFrame({ x: 0.8, y: 0.5 }, f);
  if (Math.abs(tl.x) > 1e-9 || Math.abs(tl.y) > 1e-9) throw new Error('top-left wrong');
  if (Math.abs(br.x - 1) > 1e-9 || Math.abs(br.y - 1) > 1e-9) throw new Error('bottom-right wrong');
});
t('with no frame a part keeps its page position', () => {
  const p = pointInFrame({ x: 0.3, y: 0.7 }, null);
  if (p.x !== 0.3 || p.y !== 0.7) throw new Error('moved without a frame');
});
t('cropping re-sides the labels against what is on screen', () => {
  // At page x=0.45 this part is left-of-centre, but a frame covering
  // 0.4..1.0 puts it hard against the left edge -- still left. A frame
  // covering 0.0..0.5 puts it near the right edge, so its label belongs
  // on the right or the leader line crosses the whole view.
  const part = [at(0.45, 0.5), at(0.05, 0.5)];
  const rightHalf = layoutCallouts(part, { x: 0.0, y: 0.3, w: 0.5, h: 0.4 });
  const c = rightHalf.callouts.find(x => x.component.position.x === 0.45);
  if (c.side !== 'right') throw new Error('expected a right-hand label, got ' + c.side);
});
t('a cropped point still lands inside the image band', () => {
  const f = { x: 0.1, y: 0.4, w: 0.8, h: 0.3 };
  for (const c of layoutCallouts(conveyor, f).callouts) {
    if (c.pointX < IMAGE_LEFT - 1e-9 || c.pointX > IMAGE_LEFT + IMAGE_WIDTH + 1e-9) {
      throw new Error('pointX outside the band: ' + c.pointX);
    }
  }
});

console.log('\n=== framing: how the sheet is scaled behind the frame ===');
t('the view box takes the crop\'s real proportions', () => {
  // Half the width and a quarter the height of a 1000x500 page is
  // 500x125 of pixels -- 4:1.
  const s = frameImageStyle({ x: 0, y: 0, w: 0.5, h: 0.25 }, 1000, 500);
  if (Math.abs(s.aspectRatio - 4) > 1e-9) throw new Error('got ' + s.aspectRatio);
});
t('the sheet is blown up by exactly the crop factor', () => {
  const s = frameImageStyle({ x: 0, y: 0, w: 0.25, h: 0.5 }, 1000, 500);
  if (Math.abs(s.width - 400) > 1e-9) throw new Error('got width ' + s.width);
});
t('and shifted so the crop is what shows through', () => {
  const s = frameImageStyle({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1000, 500);
  if (Math.abs(s.left - -50) > 1e-9) throw new Error('got left ' + s.left);
  if (Math.abs(s.top - -200) > 1e-9) throw new Error('got top ' + s.top);
});
t('an unmeasured page gives no crop rather than a wrong one', () => {
  if (frameImageStyle({ x: 0, y: 0, w: 0.5, h: 0.5 }, undefined, undefined) !== null) {
    throw new Error('expected null without page dimensions');
  }
  if (frameImageStyle(null, 1000, 500) !== null) throw new Error('expected null without a frame');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
