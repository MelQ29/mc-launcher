import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';

/** Streams the file through a SHA-256 hasher. Returns lowercase hex digest. */
export async function sha256File(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function sha256Buffer(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Returns true if the file exists and matches the expected lowercase-hex SHA-256. */
export async function verifyFile(filePath: string, expectedSha256: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  const actual = await sha256File(filePath);
  return actual.toLowerCase() === expectedSha256.toLowerCase();
}
