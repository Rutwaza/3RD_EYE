/** Pure tracking, quality and voting policy for Face Map. No DOM, no models. */

export const MIN_FACE_EDGE_PX = 80;
export const ENROLL_MIN_FACE_EDGE_PX = 140;
export const MIN_FACE_SCORE = 0.6;
export const MAX_YAW_RAD = 0.6;
export const MAX_PITCH_RAD = 0.55;
export const MIN_SHARPNESS = 18;
export const MIN_LIVENESS = 0.45;

const VOTE_WINDOW = 10;
const VOTES_NEEDED = 3;
const VOTE_SHARE = 0.6;
const MAX_MISSED_FRAMES = 8;

/** Overlap of two [x, y, width, height] boxes, from 0 to 1. */
export function iou(a, b) {
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const shared = Math.max(0, right - left) * Math.max(0, bottom - top);
  const total = a[2] * a[3] + b[2] * b[3] - shared;
  return total > 0 ? shared / total : 0;
}

/** How much of the small box lies inside the large one. */
export function containment(small, large) {
  const left = Math.max(small[0], large[0]);
  const top = Math.max(small[1], large[1]);
  const right = Math.min(small[0] + small[2], large[0] + large[2]);
  const bottom = Math.min(small[1] + small[3], large[1] + large[3]);
  const shared = Math.max(0, right - left) * Math.max(0, bottom - top);
  const area = small[2] * small[3];
  return area > 0 ? shared / area : 0;
}

/** Square views of a frame: the whole frame padded, then one close-up tile. */
export function peopleViews(width, height, frameNumber) {
  const size = Math.max(width, height);
  const views = [
    { x: (width - size) / 2, y: (height - size) / 2, size },
  ];
  const tile = Math.min(width, height);
  if (size > tile * 1.15) {
    const far = frameNumber % 2 === 1;
    views.push(
      width > height
        ? { x: far ? width - tile : 0, y: 0, size: tile }
        : { x: 0, y: far ? height - tile : 0, size: tile },
    );
  }
  return views;
}

/** Clip to the frame and drop repeats of the same person, best first. */
export function mergePeople(found, width, height) {
  const kept = [];
  for (const person of [...found].sort((a, b) => b.score - a.score)) {
    const left = Math.max(0, person.box[0]);
    const top = Math.max(0, person.box[1]);
    const right = Math.min(width, person.box[0] + person.box[2]);
    const bottom = Math.min(height, person.box[1] + person.box[3]);
    if (right - left < 12 || bottom - top < 24) continue;
    const box = [left, top, right - left, bottom - top];
    if (
      kept.some(
        (other) =>
          iou(other.box, box) > 0.4 ||
          containment(box, other.box) > 0.75 ||
          containment(other.box, box) > 0.75,
      )
    )
      continue;
    kept.push({ ...person, box });
  }
  return kept;
}

/**
 * The part of a person where a face can be, padded, inside the frame. Heads sit
 * in the upper half of a standing body; a wide box is usually a close view.
 */
export function headRegion(box, frameWidth, frameHeight) {
  const [x, y, width, height] = box;
  const tall = height > width * 1.4;
  const padX = width * 0.15;
  const padTop = height * 0.08;
  const left = Math.max(0, Math.floor(x - padX));
  const top = Math.max(0, Math.floor(y - padTop));
  const right = Math.min(frameWidth, Math.ceil(x + width + padX));
  const bottom = Math.min(
    frameHeight,
    Math.ceil(y + height * (tall ? 0.55 : 1) + padTop),
  );
  return [left, top, Math.max(1, right - left), Math.max(1, bottom - top)];
}

/** Variance of a Laplacian over greyscale pixels; low means blurred. */
export function sharpnessOf(data, width, height) {
  if (width < 3 || height < 3) return 0;
  const grey = new Float32Array(width * height);
  for (let index = 0; index < grey.length; index += 1)
    grey[index] =
      data[index * 4] * 0.299 +
      data[index * 4 + 1] * 0.587 +
      data[index * 4 + 2] * 0.114;
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1)
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - width] - grey[i + width];
      sum += value;
      squares += value * value;
      count += 1;
    }
  const mean = sum / count;
  return squares / count - mean * mean;
}

/** Decide whether one face is good enough to compare with the database. */
export function assessFace(face, { minEdgePx = MIN_FACE_EDGE_PX } = {}) {
  const edge = Math.min(face.box?.[2] || 0, face.box?.[3] || 0);
  if (!(edge >= minEdgePx))
    return { usable: false, code: 'small', reason: `face is ${Math.round(edge)}px, needs ${minEdgePx}px` };
  if (!(face.score >= MIN_FACE_SCORE))
    return { usable: false, code: 'unsure', reason: 'face detection is uncertain' };
  if (Math.abs(face.yaw ?? 0) > MAX_YAW_RAD || Math.abs(face.pitch ?? 0) > MAX_PITCH_RAD)
    return { usable: false, code: 'turned', reason: 'face is turned away' };
  if (Number.isFinite(face.sharpness) && face.sharpness < MIN_SHARPNESS)
    return { usable: false, code: 'blurred', reason: 'face is blurred' };
  if (
    (Number.isFinite(face.real) && face.real < MIN_LIVENESS) ||
    (Number.isFinite(face.live) && face.live < MIN_LIVENESS)
  )
    return { usable: false, code: 'spoof', reason: 'may be a photo or a screen' };
  return { usable: true, code: 'ok', reason: '' };
}

/**
 * Follow people between frames and require agreement across several frames
 * before naming a candidate. One lucky frame never decides.
 */
export function createTracker({ votesNeeded = VOTES_NEEDED } = {}) {
  let tracks = [];
  let nextId = 1;

  function decide(track) {
    const tally = new Map();
    for (const vote of track.votes) {
      const row = tally.get(vote.id) || { ...vote, count: 0, total: 0 };
      row.count += 1;
      row.total += vote.similarityPct;
      tally.set(vote.id, row);
    }
    const ranked = [...tally.values()].sort((a, b) => b.count - a.count);
    const top = ranked[0];
    const used = track.votes.length;
    if (top && top.id && top.count >= votesNeeded && top.count / used >= VOTE_SHARE)
      return {
        state: 'candidate',
        id: top.id,
        name: top.name,
        category: top.category,
        similarityPct: Math.round(top.total / top.count),
        votes: top.count,
      };
    if (used >= votesNeeded + 2) return { state: 'unknown', votes: used };
    if (used) return { state: 'analysing', votes: used, needed: votesNeeded };
    return { state: track.faceSeen ? 'low-quality' : 'human', votes: 0 };
  }

  return {
    /**
     * @param {Array<{box:number[], score:number, face?:object, vote?:object}>} people
     * @returns {Array<object>} Current tracks in stable order.
     */
    update(people) {
      const free = new Set(people.map((_, index) => index));
      const pairs = [];
      tracks.forEach((track, t) =>
        people.forEach((person, p) => {
          const score = iou(track.box, person.box);
          if (score > 0.2) pairs.push([score, t, p]);
        }),
      );
      pairs.sort((a, b) => b[0] - a[0]);
      const taken = new Set();
      for (const [, t, p] of pairs) {
        if (taken.has(t) || !free.has(p)) continue;
        taken.add(t);
        free.delete(p);
        apply(tracks[t], people[p]);
      }
      tracks.forEach((track, t) => {
        if (!taken.has(t)) track.missed += 1;
      });
      for (const p of free) {
        const track = {
          id: `H${String(nextId).padStart(2, '0')}`,
          votes: [],
          missed: 0,
          frames: 0,
          faceSeen: false,
          reported: null,
        };
        nextId += 1;
        apply(track, people[p]);
        tracks.push(track);
      }
      tracks = tracks.filter((track) => track.missed <= MAX_MISSED_FRAMES);
      return tracks
        // A close-up tile is read every second frame, so one gap is normal.
        .filter((track) => track.missed <= 1)
        .map((track) => ({
          id: track.id,
          box: track.box,
          score: track.score,
          face: track.face,
          frames: track.frames,
          decision: decide(track),
        }));
    },
    /** True the first time a track settles on this candidate. */
    claimReport(trackId, identityId) {
      const track = tracks.find(({ id }) => id === trackId);
      if (!track || track.reported === identityId) return false;
      track.reported = identityId;
      return true;
    },
    reset() {
      tracks = [];
      nextId = 1;
    },
  };

  function apply(track, person) {
    track.box = person.box;
    track.score = person.score;
    track.face = person.face || null;
    track.missed = 0;
    track.frames += 1;
    if (person.face) track.faceSeen = true;
    if (person.vote) {
      track.votes.push(person.vote);
      if (track.votes.length > VOTE_WINDOW) track.votes.shift();
    }
  }
}
