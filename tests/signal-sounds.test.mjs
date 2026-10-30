import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await read(path));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

test('every sound recording has checksum-verified provenance and a pack license', async () => {
  const { packs, recordings } = await json('licenses/signal-sounds/sources.json');
  const byPack = new Map(packs.map(pack => [pack.id, pack]));
  assert.equal(byPack.size, packs.length);
  const files = [];
  for (const [folder, count] of [['freesound', 23], ['kenney', 26], ['vsco', 5]]) {
    const directory = `tooling/signal-sounds/sources/${folder}/`;
    const names = await readdir(new URL(directory, root));
    assert.equal(names.length, count);
    files.push(...names.map(name => directory + name));
  }
  assert.deepEqual(recordings.map(recording => recording.file).sort(), files.sort());
  for (const pack of packs) {
    assert.ok(pack.name && pack.version && pack.author && pack.url);
    assert.equal(pack.license, 'CC0-1.0');
    assert.equal(sha256(await read(pack.licenseFile)), pack.licenseSha256);
    if (pack.downloadUrl) {
      assert.match(pack.archiveSha256, /^[a-f0-9]{64}$/);
      assert.ok(pack.licenseArchivePath);
    }
  }
  for (const recording of recordings) {
    assert.equal(sha256(await read(recording.file)), recording.sha256, recording.file);
    const pack = byPack.get(recording.pack);
    assert.ok(pack, recording.file);
    assert.equal(recording.license, 'CC0-1.0');
    if (recording.pack === 'freesound') {
      assert.ok(recording.author && recording.title && recording.url && recording.downloadUrl && recording.version);
      assert.match(recording.upstreamPath, /-hq\.mp3$/);
    } else {
      assert.ok(recording.archivePath || recording.verification.startsWith('no byte match found in '));
      if (recording.verification === 'byte-match') assert.ok(recording.matchingArchivePaths.includes(recording.archivePath));
    }
  }
});

test('sound manifest checks every shipped AAC file and pins its MP4 timestamps', async () => {
  const { entries } = await json('tooling/signal-sounds/manifest.json');
  const directory = 'apps/extension/public/signals/';
  assert.deepEqual(entries.map(entry => entry.file).sort(), (await readdir(new URL(`${directory}sounds/`, root))).map(file => `sounds/${file}`).sort());
  assert.equal(entries.length, 36);
  for (const entry of entries) {
    const bytes = await read(directory + entry.file);
    assert.equal(bytes.length, entry.bytes);
    assert.equal(sha256(bytes), entry.sha256, entry.file);
    assert.ok(Number.isInteger(entry.mp4Timestamp) && entry.mp4Timestamp > 0);
    let timestamps = 0;
    function visit(start, end) {
      while (start < end) {
        const size = bytes.readUInt32BE(start), kind = bytes.toString('ascii', start + 4, start + 8);
        assert.ok(size >= 8 && start + size <= end);
        if (['mvhd', 'tkhd', 'mdhd'].includes(kind)) {
          assert.equal(bytes[start + 8], 0);
          assert.equal(bytes.readUInt32BE(start + 12), entry.mp4Timestamp);
          assert.equal(bytes.readUInt32BE(start + 16), entry.mp4Timestamp);
          timestamps++;
        } else if (['moov', 'trak', 'mdia'].includes(kind)) visit(start + 8, start + size);
        start += size;
      }
    }
    visit(0, bytes.length);
    assert.equal(timestamps, 3);
  }
});
