---
status: pending
---

# Add OAuth Secret Entries to Environment Examples

Update `secrets/dev.env.example` and `secrets/prod.env.example` with
placeholder entries for all three OAuth integrations.

Required entries:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `PIKE13_CLIENT_ID`
- `PIKE13_CLIENT_SECRET`

Each entry should have a descriptive placeholder value (e.g.,
`your-github-client-id-here`). Group them under comments so the file
is easy to scan.

Also update `docs/secrets.md` Required Secrets table if it lists
application secrets.
