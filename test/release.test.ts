import { describe, expect, it } from 'vitest'
import agents from '../AGENTS.md?raw'
import contributing from '../CONTRIBUTING.md?raw'
import engineering from '../ENGINEERING.md?raw'
import release from '../.github/workflows/release.yml?raw'
import verify from '../.github/workflows/verify.yml?raw'
import changelog from '../CHANGELOG.md?raw'

const NPM_TRUST = 'npm trust github accuracy-claim-kit --file release.yml --repo lkopietz3-byte/accuracy-claim-kit --allow-publish --yes'

describe('release-review: the release workflow publishes once, from a verified commit, with no cache', () => {
  it('release-review:no-cache-in-publish-job the publish job sets up Node with no npm cache', () => {
    expect(release).not.toMatch(/^\s*cache:/m)
  })

  it('release-review:green-verify-gate the release needs a successful Verify run for the tagged commit', () => {
    expect(release).toContain('actions: read')
    expect(release).toContain('gh run list --repo "$GITHUB_REPOSITORY" --workflow verify.yml --commit "$GITHUB_SHA" --status success')
  })

  it('release-review:publish-ignore-scripts npm publish skips lifecycle scripts so the suite does not run twice', () => {
    expect(release).toMatch(/^\s*run: npm publish --ignore-scripts$/m)
    expect(release).not.toMatch(/run: npm publish\s*$/m)
  })

  it('release-review:actions-pinned every action is pinned by commit SHA and checkout does not persist credentials', () => {
    for (const text of [release, verify]) {
      const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
      expect(uses.length).toBeGreaterThan(0)
      for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/)
      expect(text.match(/persist-credentials: false/g)!.length).toBe(text.match(/actions\/checkout@/g)!.length)
    }
  })

  it('release-review:bench-in-verify the Verify workflow runs the benchmark so the pinned headline numbers are protected', () => {
    expect(verify).toContain('run: npm run bench')
  })
})

describe('release-review: the docs describe the 0.1.0 first publish exactly', () => {
  it('release-review:first-publish-path CONTRIBUTING.md and ENGINEERING.md give the npm trust command, the owner-only fallback and the provenance consequence', () => {
    for (const text of [contributing, engineering]) {
      expect(text).toContain(NPM_TRUST)
      expect(text).toContain('npm publish')
      expect(text).toContain('no provenance')
      expect(text).toContain('same day')
      expect(text).toContain('0.1.1')
    }
    expect(contributing).toContain('Only the owner takes either one; an agent never runs `npm trust` or `npm publish`')
    expect(engineering).toContain('the owner (never an agent) runs `npm publish` once')
  })

  it('release-review:no-blanket-never-publish no doc still says nobody ever publishes by hand without naming the first-publish exception', () => {
    expect(contributing).not.toContain('Nobody runs `npm publish` by hand.\n')
    expect(engineering).not.toContain('Nobody runs `npm publish` by hand;')
    expect(agents).not.toContain('Never run `npm publish` by hand')
    expect(agents).toContain('The one exception is the 0.1.0 first publish')
  })

  it('release-review:changelog-date the 0.1.0 entry is dated 2026-10-15', () => {
    expect(changelog).toContain('## [0.1.0] - 2026-10-15')
  })
})

describe('release:trusted-publisher-timing a hand-published 0.1.0 gets its trusted publisher on the day of the 0.1.1 release', () => {
  it('release:trusted-publisher-timing CONTRIBUTING.md and ENGINEERING.md set it up on the day of the 0.1.1 release, because npm expires an unused setting after 2 days', () => {
    for (const [name, text] of [['CONTRIBUTING', contributing], ['ENGINEERING', engineering]] as const) {
      expect(text, name).toContain('on the day of the 0.1.1 release')
      expect(text, name).toContain('expires')
      expect(text, name).toContain('2 days')
      expect(text, name).not.toContain('the same `npm trust github` command the same day')
      expect(text, name).not.toContain('then sets up trusted publishing the same day')
    }
  })
})
