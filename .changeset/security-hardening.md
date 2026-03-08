---
default: patch
---

# Security hardening: OAuth CSRF, credential isolation, input validation

Comprehensive security audit and fix addressing 9 vulnerabilities:

### Critical
- **OAuth CSRF protection**: `/auth/login` now sets an `__oauth_state` cookie;
  `/auth/callback` validates the state parameter matches the cookie before
  completing the flow. Prevents login CSRF attacks where an attacker tricks a
  victim into authenticating as the attacker's account.
- **Encryption secret validation**: Server now refuses to start in production
  without `ENCRYPTION_SECRET` set. Warns in development. Previously silently
  used a hardcoded default.

### High
- **CORS removed**: Removed blanket `Access-Control-Allow-Origin: *` header.
  The SPA is same-origin so CORS is unnecessary.
- **gistId input validation**: `/api/publish` now validates gistId is a hex
  string (`/^[a-f0-9]{1,64}$/`), preventing SSRF via path traversal in the
  GitHub API URL.
- **Security headers**: All responses now include `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-XSS-Protection`, and `Permissions-Policy`.

### Medium
- **Session ID validation**: Cookie extraction now rejects non-UUID values before
  KV lookup, preventing arbitrary DB reads.
- **Platform validation on DELETE**: `DELETE /api/platforms/:platform` now validates
  against `ALL_PLATFORMS` before writing to KV.
- **Store defense-in-depth**: `store.save()` asserts `publication.userId === userId`
  to catch cross-tenant contamination bugs.
- **Error sanitization**: OAuth callback no longer leaks internal error details.

### Tests
- 21 new security-focused tests covering cross-user publication/credential/storage
  isolation, session forgery, CSRF protection, path traversal, and security headers.
