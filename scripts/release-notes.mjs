/**
 * Prints the GitHub release notes for a tag: its CHANGELOG.md section followed by how to verify the package.
 *
 * Usage: node scripts/release-notes.mjs <tag> <commit>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseNotes(changelog, tag, commit) {
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find(text => text.split('\n', 1)[0].trim() === tag);
  if (!section) throw new Error(`CHANGELOG.md has no "## ${tag}" section`);
  const version = tag.replace(/^v/, '');
  return `${section.slice(section.indexOf('\n') + 1).trim()}

### Verify this package · 校验安装包

\`palside-${version}-chrome.zip\` is the exact package submitted to the Chrome Web Store, built by GitHub Actions from commit ${commit}.

\`\`\`sh
gh attestation verify palside-${version}-chrome.zip --repo palsidexyz/palside-extension
mkdir palside && unzip -q palside-${version}-chrome.zip -d palside && cd palside
grep -v chrome.zip ../SHA256SUMS.txt | shasum -a 256 -c
\`\`\`
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, commit] = process.argv.slice(2);
  if (!tag || !/^[0-9a-f]{40}$/.test(commit ?? '')) {
    console.error('Usage: node scripts/release-notes.mjs <tag> <commit>');
    process.exit(1);
  }
  process.stdout.write(releaseNotes(readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8'), tag, commit));
}
