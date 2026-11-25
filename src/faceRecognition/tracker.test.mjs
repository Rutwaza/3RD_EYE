import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessFace,
  createTracker,
  headRegion,
  iou,
  mergePeople,
  peopleViews,
  sharpnessOf,
} from './tracker.js';

const good = { box: [0, 0, 120, 120], score: 0.9, yaw: 0, pitch: 0, sharpness: 90, real: 0.9, live: 0.9 };
const vote = { id: 'a', name: 'Ada', category: 'visitor', similarityPct: 88 };
const person = (x, extra = {}) => ({ box: [x, 0, 100, 300], score: 0.8, ...extra });

test('a face is refused for size, angle, blur or a likely photo', () => {
  assert.equal(assessFace(good).usable, true);
  assert.equal(assessFace({ ...good, box: [0, 0, 60, 120] }).code, 'small');
  assert.equal(assessFace({ ...good, score: 0.3 }).code, 'unsure');
  assert.equal(assessFace({ ...good, yaw: 0.9 }).code, 'turned');
  assert.equal(assessFace({ ...good, sharpness: 3 }).code, 'blurred');
  assert.equal(assessFace({ ...good, live: 0.1 }).code, 'spoof');
});

test('a wide frame is padded to a square and gets one alternating close-up', () => {
  const [whole, left] = peopleViews(1280, 720, 0);
  assert.deepEqual(whole, { x: 0, y: -280, size: 1280 });
  assert.deepEqual(left, { x: 0, y: 0, size: 720 });
  assert.equal(peopleViews(1280, 720, 1)[1].x, 560);
  assert.equal(peopleViews(720, 720, 0).length, 1);
});

test('repeat detections of one person collapse, separate people stay', () => {
  const kept = mergePeople(
    [
      { score: 0.6, box: [100, 10, 100, 300] },
      { score: 0.9, box: [104, 8, 100, 305] },
      { score: 0.7, box: [600, 10, 90, 300] },
      { score: 0.9, box: [-50, -40, 40, 30] },
    ],
    1280,
    720,
  );
  assert.deepEqual(kept.map(({ score }) => score), [0.9, 0.7]);
});

test('the head region covers the upper body and stays inside the frame', () => {
  const [x, y, width, height] = headRegion([10, 5, 100, 300], 200, 400);
  assert.ok(x >= 0 && y >= 0 && x + width <= 200);
  assert.ok(height < 300, 'a standing body is cut above the waist');
});

test('one matching frame never names a candidate; three agreeing frames do', () => {
  const tracker = createTracker();
  const states = [1, 2, 3].map(
    () => tracker.update([person(0, { face: good, vote })])[0].decision.state,
  );
  assert.deepEqual(states, ['analysing', 'analysing', 'candidate']);
});

test('disagreeing frames end as unknown', () => {
  const tracker = createTracker();
  const none = { id: null, name: '', similarityPct: 40 };
  let decision;
  for (const item of [vote, none, none, none, none])
    [{ decision }] = tracker.update([person(0, { face: good, vote: item })]);
  assert.equal(decision.state, 'unknown');
});

test('people keep their number while moving, and a new person gets a new one', () => {
  const tracker = createTracker();
  tracker.update([person(0)]);
  const [first, second] = tracker.update([person(20), person(600)]);
  assert.equal(first.id, 'H01');
  assert.equal(second.id, 'H02');
});

test('a sighting is reported once per person in view', () => {
  const tracker = createTracker();
  const [{ id }] = tracker.update([person(0)]);
  assert.equal(tracker.claimReport(id, 'a'), true);
  assert.equal(tracker.claimReport(id, 'a'), false);
});

test('overlap and sharpness behave at their limits', () => {
  assert.equal(iou([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(iou([0, 0, 10, 10], [20, 20, 5, 5]), 0);
  const flat = new Uint8ClampedArray(16 * 16 * 4).fill(120);
  const noisy = flat.map((_, i) => ((i >> 2) % 2 ? 255 : 0));
  assert.equal(sharpnessOf(flat, 16, 16), 0);
  assert.ok(sharpnessOf(noisy, 16, 16) > 100);
});
