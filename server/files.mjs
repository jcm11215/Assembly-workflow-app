/**
 * Blueprint files on the server's disk, under data/files/:
 *
 *   data/files/24-1050/General Arrangement.pdf
 *   data/files/24-1050/General Arrangement (v2).pdf
 *
 * A folder per job and the name it was uploaded with, so someone can
 * open the folder on the server and find a drawing without the app. The
 * database stores the path relative to data/files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Characters allowed in a folder or file name; anything else becomes
 *  '_', and nothing can name a parent directory. */
export function safeName(name, fallback){
  const s = String(name || '')
    .replace(/[^A-Za-z0-9 ._()-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return s || fallback;
}

/** The only file types a drawing may be stored as. Anything else is kept
 *  as an opaque download: the files are served from the app's own
 *  address, so an uploaded web page must never be able to run there. */
const SAFE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']);
export const safeMimeType = type => (SAFE_TYPES.has(String(type || '').toLowerCase()) ? String(type).toLowerCase() : 'application/octet-stream');

const EXT_BY_MIME = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic'
};

export function extensionFor(mimeType, fileName){
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(String(fileName || ''));
  return EXT_BY_MIME[mimeType] || (fromName ? fromName[1].toLowerCase() : 'bin');
}

/** The relative path a blueprint's file is stored at. A re-scan keeps
 *  the earlier file and lands beside it with a "(vN)" suffix. */
export function relativePathFor(jobNumber, fileName, mimeType, version){
  const ext = extensionFor(mimeType, fileName);
  const stem = safeName(String(fileName || '').replace(/\.[A-Za-z0-9]{1,8}$/, ''), 'blueprint');
  const name = version > 1 ? `${stem} (v${version}).${ext}` : `${stem}.${ext}`;
  return `${safeName(jobNumber, 'job')}/${safeName(name, `blueprint.${ext}`)}`;
}

/** Resolves a stored relative path, refusing anything outside the root. */
export function absolutePath(root, rel){
  const abs = path.resolve(root, rel);
  if(!abs.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing path outside the files folder: ${rel}`);
  return abs;
}

/** Writes via a temporary file and a rename, so a half-written upload is
 *  never left where a reader could open it. */
export async function writeFileAtomic(root, rel, bytes){
  const abs = absolutePath(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomBytes(4).toString('hex')}.part`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, abs);
}

export async function deleteJobFiles(root, relPaths){
  for(const rel of relPaths){
    try { await fs.unlink(absolutePath(root, rel)); } catch { /* already gone */ }
  }
  // Remove folders left empty; a folder that still holds anything stays.
  for(const dir of new Set(relPaths.map(p => path.dirname(p)))){
    try { await fs.rmdir(absolutePath(root, dir)); } catch { /* not empty, gone, or the root itself */ }
  }
}
