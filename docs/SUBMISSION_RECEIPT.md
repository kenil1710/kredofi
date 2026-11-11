# Hackathon submission receipt

- **Sent:** 2026-11-11 (one attempt, no retry)
- **Endpoint:** `POST https://nearhackathon.com/api/applications` (HACKATHON.md)
- **requestId:** `b8b63a36-d57f-4178-9aeb-e7222bb02007`
- **Server response:** HTTP 201 Created, empty body

## Recorded: public directory check (2026-11-11, read-only)

`GET https://nearhackathon.com/api/projects?page=1&q=KredoFi` (the directory behind the site's "Submitted projects" list) returned exactly one project:

```
id: b8b63a36-d57f-4178-9aeb-e7222bb02007   (= our requestId)
project_name: KredoFi
tracks: defi, privacy, realworld
demo_url: https://x.com/KredoFi/status/2120460127384084766
```

One entry, saved under our requestId, so the submission is recorded once. The directory does not show the repository, email or payout account. The rules (HACKATHON.md) offer no status lookup and mention no confirmation email. Corrections go through https://nearhackathon.com/request-changes, never a second submission.

## What was submitted

| Field | Value |
|---|---|
| projectName | KredoFi |
| leadName | Kenil Vekariya |
| email | (withheld from this file) |
| size | 1 |
| tracks | privacy, defi, realworld |
| nearAddress | `7f560f36197e08cbac89aa97cf4142c32a11f607b1b7d2de27e02b5ea9c541bc` (the lead's HOT wallet, payout only; not the dev account, not kredofi.near) |
| projectUrl | https://github.com/kenil1710/kredofi |
| demoUrl | https://x.com/KredoFi/status/2120460127384084766 |
| idea | text of `docs/SUBMISSION.md` at commit 69b8def (1,992 characters) |
| consent | true |
