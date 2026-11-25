import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Models the panel may load: people, faces, descriptors and liveness. */
export const FACE_MODELS = Object.freeze([
  'centernet',
  'blazeface',
  'facemesh',
  'faceres',
  'antispoof',
  'liveness',
]);

/**
 * Read one allowlisted model file. Weights are published as `.weights`, because
 * download managers such as IDM seize `.bin` requests from the browser and the
 * model then loads empty.
 */
export async function readModelFile(root, filename) {
  const { name, ext } = path.parse(filename);
  if (!FACE_MODELS.includes(name)) return null;
  if (ext === '.weights') return readFile(path.join(root, `${name}.bin`));
  if (ext !== '.json') return null;
  const manifest = JSON.parse(
    await readFile(path.join(root, `${name}.json`), 'utf8'),
  );
  for (const group of manifest.weightsManifest || [])
    group.paths = group.paths.map((file) => file.replace(/\.bin$/, '.weights'));
  return Buffer.from(JSON.stringify(manifest));
}
