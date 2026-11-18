/**
 * Prints the GitHub release notes for a tag: its CHANGELOG.md section (English and Chinese
 * mirrored), the requirement and compare link, then how to verify the package.
 *
 * Usage: node scripts/release-notes.mjs <tag> <commit>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'palsidexyz/palside-extension';
const HEADINGS = ["### What's new", '### 更新内容'];

export function releaseNotes(changelog, tag, commit) {
  const sections = changelog.split(/^## /m).slice(1);
  const titles = sections.map(text => text.split('\n', 1)[0].trim());
  const index = titles.indexOf(tag);
  if (index < 0) throw new Error(`CHANGELOG.md has no "## ${tag}" section`);
  const body = sections[index].slice(sections[index].indexOf('\n') + 1).trim();
  for (const heading of HEADINGS) {
    if (!body.split('\n').includes(heading)) throw new Error(`CHANGELOG.md section ${tag} needs a "${heading}" heading`);
  }
  const version = tag.replace(/^v/, '');
  const previous = titles[index + 1];
  const footer = ['**Requires** desktop Chrome 130 or later · 需要桌面版 Chrome 130 或更高版本'];
  if (previous) footer.push(`**Full Changelog**: https://github.com/${REPOSITORY}/compare/${previous}...${tag}`);
  return `${body}

---

${footer.join('\\\n')}

<details>
<summary>Verify this package · 校验安装包</summary>

\`palside-${version}-chrome.zip\` is the exact package submitted to the Chrome Web Store, built by GitHub Actions from commit ${commit}.

\`\`\`sh
# 1. Build provenance
gh attestation verify palside-${version}-chrome.zip --repo ${REPOSITORY}

# 2. File checksums
mkdir palside && unzip -q palside-${version}-chrome.zip -d palside && cd palside
grep -v chrome.zip ../SHA256SUMS.txt | shasum -a 256 -c
\`\`\`

</details>
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
