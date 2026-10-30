import { RECRUITMENT_TTL_MS, APPLICATION_TTL_MS } from '../packages/shared/src/contracts/limits.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTeams, isRecruiting, publishRecruitment, requestIsActive } from '../apps/extension/src/domain/teams/lobby-values.ts';
import { siteCatalog, siteForUrl } from '../apps/extension/src/features/palside/settings/site-catalog.ts';
import { sites, siteCategories as registryCategories } from '../packages/shared/src/sites/index.ts';

test('lobby only exposes published teams and filters without changing publication order or the source list', () => {
  const teams = [
    { id: 'hidden', name: 'Secret', description: 'Solana', published: false, publishedAt: 100 },
    { id: 'old', name: 'Alpha', description: 'research', published: true, recruitmentExpiresAt: 1000, publishedAt: 10 },
    { id: 'new', name: 'Beta', description: 'ALPHA notes', published: true, recruitmentExpiresAt: 1000, publishedAt: 20 },
  ];
  assert.deepEqual(publicTeams(teams, 'alpha', 100).map(team => team.id), ['new', 'old']);
  assert.deepEqual(publicTeams(teams, 'secret', 100), []);
  assert.deepEqual(teams.map(team => team.id), ['hidden', 'old', 'new']);
  const edited = teams.map(team => team.id === 'old' ? { ...team, description: 'edited' } : team);
  assert.deepEqual(publicTeams(edited, '', 100).map(team => team.id), ['new', 'old']);
});

test('site presets match exact public hosts and never silently authorize added sites or lookalike subdomains', () => {
  assert.equal(siteForUrl('https://gmgn.ai/robinhood/token/abc')?.id, 'gmgn');
  assert.equal(siteForUrl('https://gmgn.ai.evil.example/token'), undefined);
  assert.equal(siteForUrl('https://private.gmgn.ai/'), undefined);
  assert.equal(siteForUrl('javascript:alert(1)'), undefined);
  assert.equal(siteForUrl('not a URL'), undefined);
  // A site is authorized only by its Chrome grant; no preset entry carries an on/off of its own.
  assert.equal(siteCatalog.some(site => ['share', 'interact', 'enabled', 'allowed'].some(key => key in site)), false, 'no preset site shares or interacts before it is added');
  assert.equal(siteCatalog.some(site => 'quickStart' in site), false);
  assert.equal(new Set(siteCatalog.map(site => site.domain)).size, siteCatalog.length);
});

test('shared registry lists each site once with an exact host, and every one of the twelve categories is used', () => {
  assert.equal(siteCatalog.length, sites.length);
  assert.equal(new Set(siteCatalog.map(site => site.id)).size, siteCatalog.length);
  assert.equal(new Set(siteCatalog.map(site => site.domain)).size, siteCatalog.length);
  assert.ok(siteCatalog.every(site => /^[a-z0-9-]+$/.test(site.id) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site.domain)));
  assert.equal(registryCategories.length, 12);
  assert.ok(sites.every(site => registryCategories.includes(site.category)));
  assert.ok(registryCategories.every(category => sites.some(site => site.category === category)));
});

test('recruitment expires at seven days, editing and repeated publication do not extend it', () => {
  const started = 1000;
  const team = publishRecruitment({ id: 'one', name: 'One', description: '', published: false }, started);
  assert.equal(team.recruitmentExpiresAt, started + RECRUITMENT_TTL_MS);
  assert.equal(isRecruiting(team, team.recruitmentExpiresAt - 1), true);
  assert.equal(isRecruiting(team, team.recruitmentExpiresAt), false);
  assert.equal(publishRecruitment(team, started + 100), team);
  assert.deepEqual(publicTeams([team], '', team.recruitmentExpiresAt), []);
  assert.equal(isRecruiting({ ...team, published: false }, started + 100), false);
  assert.equal(isRecruiting({ ...team, recruitmentExpiresAt: undefined }, started), false);
  const republished = publishRecruitment(team, team.recruitmentExpiresAt + 1);
  assert.equal(republished.publishedAt, team.recruitmentExpiresAt + 1);
  assert.equal(republished.recruitmentExpiresAt, team.recruitmentExpiresAt + 1 + RECRUITMENT_TTL_MS);
});

test('pending applications keep their own expiry after recruitment ends', () => {
  const team = publishRecruitment({ id: 'one', name: 'One', description: '', published: false }, 1000);
  const request = { teamId: 'one', createdAt: 2000, expiresAt: 2000 + APPLICATION_TTL_MS };
  assert.equal(isRecruiting(team, team.recruitmentExpiresAt), false);
  assert.equal(requestIsActive(request, team.recruitmentExpiresAt), true);
  assert.equal(requestIsActive(request, request.expiresAt), false);
});
