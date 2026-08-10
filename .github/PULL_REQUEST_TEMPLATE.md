## Summary

Describe the problem and the smallest change that solves it.

## Safety impact

- Which decisions or rules change?
- Could the change create a bypass, false allow, privacy leak, or incompatible audit record?
- Are defaults still fail-closed?

## Verification

- [ ] I added or updated tests for allowed, review, and blocked paths.
- [ ] I ran `npm run check` locally.
- [ ] I used only synthetic data and included no secrets or direct customer identifiers.
- [ ] I updated documentation and the changelog when behavior changed.
