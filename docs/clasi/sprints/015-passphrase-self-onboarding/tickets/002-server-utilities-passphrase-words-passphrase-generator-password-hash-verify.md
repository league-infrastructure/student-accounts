---
id: '002'
title: "Server utilities — passphrase-words, passphrase generator, password hash/verify"
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-004
  - SUC-005
  - SUC-006
depends-on:
  - '001'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 002 — Server utilities: passphrase-words, passphrase generator, password hash/verify

## Description

Create three pure utility modules that have no dependencies on the database, services, or Express. They are the building blocks for PassphraseService (Ticket 003) and the signup handler (Ticket 005). Doing them in isolation keeps them testable and reviewable independently.

## Acceptance Criteria

### passphrase-words.ts

- [ ] File created at `server/src/utils/passphrase-words.ts`.
- [ ] Exports a `readonly string[]` named `PASSPHRASE_WORDS`.
- [ ] Contains at least 400 words.
- [ ] All words are lowercase, 3–8 characters, common English words.
- [ ] List has been reviewed and contains nothing sexual, profane, drug-related, violent, insulting, or scatological (audience is kids). The review is explicit — not just "started from EFF".
- [ ] No duplicate entries.

### passphrase.ts

- [ ] File created at `server/src/utils/passphrase.ts`.
- [ ] `generatePassphrase(words?: 3 | 4): string` — uses `crypto.randomInt` to pick words from `PASSPHRASE_WORDS`; joins with hyphens; defaults to 3 words.
- [ ] `validatePassphraseShape(input: string): boolean` — returns true iff input is 2–4 lowercase words joined by hyphens, all words drawn from `PASSPHRASE_WORDS`.
- [ ] No non-Node-built-in imports (pure utility).

### password.ts

- [ ] File created at `server/src/utils/password.ts`.
- [ ] `hashPassword(plain: string): Promise<string>` — generates a random 16-byte salt (hex), runs `crypto.scrypt(plain, salt, 64)`, returns `"<saltHex>:<keyHex>"`.
- [ ] `verifyPassword(plain: string, stored: string): Promise<boolean>` — splits stored, re-derives key with same params, compares using `crypto.timingSafeEqual`.
- [ ] Returns `false` (not throws) if `stored` is malformed or null/undefined.
- [ ] No npm dependencies; uses only Node's built-in `crypto` module.

### Tests

- [ ] `tests/server/utils/passphrase.test.ts` created and green:
  - `generatePassphrase()` returns a string matching `/^[a-z]+-[a-z]+-[a-z]+$/`.
  - Every word in the generated phrase is in `PASSPHRASE_WORDS`.
  - No duplicate words within a single generated phrase.
  - `validatePassphraseShape` accepts valid phrases; rejects too-short, too-long, non-word-list, uppercase, no-hyphen inputs.
- [ ] `tests/server/utils/password.test.ts` created and green:
  - `hashPassword` / `verifyPassword` round-trip: correct plain-text verifies true.
  - Wrong plain-text verifies false.
  - Empty string as plain-text still hashes safely; verifies false against a different hash.
  - Null/undefined stored value returns false without throwing.
- [ ] `npm run test:server` passes with all new suites included.
- [ ] `npx tsc --noEmit` in `server/` shows no new errors.

## Implementation Plan

### Approach

All three files are pure functions with no side effects and no DB access. Write the word list first (requires the review pass), then the generators, then the hash utilities. Tests can be written test-first or alongside — the requirement is they exist and pass.

### Files to Create

- `server/src/utils/passphrase-words.ts`
- `server/src/utils/passphrase.ts`
- `server/src/utils/password.ts`
- `tests/server/utils/passphrase.test.ts`
- `tests/server/utils/password.test.ts`

### Word List Guidance

Start from the EFF short word list (1296 words, all 3–5 chars). Filter to remove: body parts used vulgarly, slurs, violence (kill, stab, dead, bomb), drugs (weed, drug, pill), anything scatological. Target ≥ 400 words after pruning. Add more common short words if needed to reach 400 (color names, animals, objects, verbs). Every word must pass a "would a reasonable teacher be comfortable if a 10-year-old saw this on the board?" test.

### Testing Plan

- New test files as listed in Acceptance Criteria above.
- Run `npm run test:server` after all three files are created.
- Run `npx tsc --noEmit` in `server/`.

### Documentation Updates

None beyond inline code comments.
