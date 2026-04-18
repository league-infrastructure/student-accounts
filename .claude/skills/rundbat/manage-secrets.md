# manage-secrets

Store and manage deployment secrets via dotconfig. Secrets are encrypted
at rest with SOPS/age and decrypted on demand.

## When to use

- "Store this credential"
- "Add a database password"
- "Update the API key"
- "Show me what secrets are configured"

## Store or update secrets

Use dotconfig's load/edit/save round-trip:

```bash
# Load to file
dotconfig load -d <env> --json

# Edit .env.json — add/modify values in the secrets section
# (use the sectioned format so new keys go to the right section)

# Save back (re-encrypts secrets)
dotconfig save --json
```

## View current config (with secrets)

```bash
# Flat — all values merged
dotconfig load -d <env> --json --flat -S

# Sectioned — see public vs secret separation
dotconfig load -d <env> --json -S
```

## Important rules

1. **Never write to `config/` directly** — always use dotconfig
2. **Never echo secret values** in output or logs
3. **Never commit decrypted secrets** — `.env` and `.env.json` should be in `.gitignore`
4. Secrets are encrypted with SOPS using age keys — run `dotconfig keys` to verify key status
