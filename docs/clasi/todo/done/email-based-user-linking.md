---
status: pending
priority: high
source: inventory app (server/src/routes/auth.ts)
---

# Email-Based User Linking Across OAuth Providers

When a user logs in via Google, then later via GitHub (or vice versa), the
app should recognize them as the same person by email address rather than
creating a duplicate user record.

## Problem

The current template upserts users on `(provider, providerId)`. A person
who logs in with Google gets one User row; logging in with GitHub creates a
second. This breaks role assignments, audit trails, and any data ownership.

## Implementation

Update the Passport OAuth callback logic for each provider (Google, GitHub,
Pike 13) to follow this lookup sequence:

1. **Find by provider ID.** Look for an existing user where the
   provider-specific ID field matches (e.g., `googleId`, `githubId`).
2. **Find by email.** If no match on provider ID, look for a user with a
   matching `email` field.
3. **Create.** If neither matches, create a new user.
4. **Link.** When found by email but the provider ID field is null, update
   the user record to add the new provider ID, linking the accounts.

### Schema Changes

Add nullable provider ID columns for each supported provider:

```prisma
model User {
  id          Int       @id @default(autoincrement())
  email       String    @unique
  displayName String?
  avatarUrl   String?
  role        UserRole  @default(USER)
  googleId    String?   @unique
  githubId    String?   @unique
  pike13Id    String?   @unique
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

### Auth Callback Logic (pseudocode)

```typescript
// In each OAuth strategy's verify callback:
async function findOrCreateUser(profile: OAuthProfile, provider: string) {
  const providerIdField = `${provider}Id`; // googleId, githubId, etc.
  const email = profile.emails?.[0]?.value;

  // 1. Find by provider ID
  let user = await prisma.user.findUnique({
    where: { [providerIdField]: profile.id }
  });

  if (!user && email) {
    // 2. Find by email
    user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // 3. Link: add provider ID to existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          [providerIdField]: profile.id,
          displayName: user.displayName || profile.displayName,
          avatarUrl: user.avatarUrl || profile.photos?.[0]?.value,
        },
      });
    }
  }

  if (!user) {
    // 4. Create new user
    user = await prisma.user.create({
      data: {
        email,
        [providerIdField]: profile.id,
        displayName: profile.displayName,
        avatarUrl: profile.photos?.[0]?.value,
      },
    });
  }

  return user;
}
```

### Role Assignment on Login

After finding or creating the user, check role assignment patterns
(see `QuartermasterPattern` / `RoleAssignmentPattern` table). The inventory
app does this on every login so that newly added patterns take effect
without requiring users to re-register:

```typescript
// After findOrCreateUser:
const patterns = await prisma.roleAssignmentPattern.findMany();
for (const p of patterns) {
  const regex = p.isRegex ? new RegExp(p.pattern) : null;
  const matches = regex ? regex.test(user.email) : user.email === p.pattern;
  if (matches && shouldPromote(user.role, p.targetRole)) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: p.targetRole },
    });
  }
}
```

## Reference Files

- Inventory: `server/src/routes/auth.ts` lines 30–85 (Google callback with
  email-based linking and pattern-based role promotion)
- Inventory: `server/prisma/schema.prisma` — `User` model and
  `QuartermasterPattern` model

## Verification

- Log in with Google → user created with googleId set
- Log in with GitHub using the same email → same user record, now has
  both googleId and githubId
- Role assignment pattern matching works on each login
- No duplicate user records for same email
