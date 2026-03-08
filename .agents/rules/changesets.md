# Changeset Rule

## When to create a changeset

Every meaningful code change **must** include a changeset file. A changeset documents how the change affects users and determines how the version number is bumped at release time.

### What counts as "meaningful"

- Bug fixes
- New features
- Breaking changes
- API changes (new endpoints, changed request/response shapes)
- UI changes visible to users
- Dependency updates that affect behaviour
- Configuration changes that affect deployment

### What does NOT need a changeset

- Code formatting / linting fixes
- Test-only changes (adding/updating tests without changing production code)
- Documentation-only changes (README, comments)
- CI/CD pipeline changes
- Refactors with no user-visible effect

## How to create a changeset

Run `knope document-change` interactively, **or** create the file manually:

```bash
knope document-change
```

This will prompt for:
1. **Change type**: `major` (breaking), `minor` (feature), or `patch` (fix)
2. **Summary**: a short description used as a changelog header

It creates a markdown file in `.changeset/` like:

```markdown
---
default: minor
---

# Short summary

Detailed description of the change and how it affects users.
```

### Manual creation

Create a file in `.changeset/` with any name ending in `.md`:

```markdown
---
default: patch
---

# Fix login redirect on Safari

The OAuth callback now correctly handles Safari's cookie policy
by using SameSite=Lax instead of SameSite=Strict.
```

## Change types

| Type    | When to use                                      | Version bump |
| ------- | ------------------------------------------------ | ------------ |
| `major` | Breaking changes, removed features, API redesign | `x.0.0`      |
| `minor` | New features, new endpoints, new UI sections     | `0.x.0`      |
| `patch` | Bug fixes, performance improvements, tweaks      | `0.0.x`      |

## Important

- **One changeset per logical change.** If a PR does multiple things, create multiple changeset files.
- **Write for users**, not developers. Describe _what changed_ from the user's perspective.
- Changesets are consumed and deleted when `knope release` runs, so they only exist in feature branches and PRs.
