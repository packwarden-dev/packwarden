# Thunderstore terms research (2026-10-14)
- No public Terms of Service or API usage policy found. pages.thunderstore.io/p/terms-of-service and thunderstore.io/terms-of-service/ return 404. The site footer links only the privacy policy.
- The privacy policy (https://pages.thunderstore.io/p/privacy-policy) mentions "our Terms of Services" but does not link to them. Contact: privacy@thunderstore.io.
- robots.txt (https://thunderstore.io/robots.txt) says `Disallow: /api/` for all agents. That rule targets crawlers, but it is a signal.
- The API (https://thunderstore.io/api/docs/) is public and unauthenticated, with CORS `*` and `cache-control: max-age=30`. No published rate limits.
- Backend code (github.com/thunderstore-io/Thunderstore) is AGPL-3.0. That covers their code, not API data. This project uses none of their code.
- r2modman (ebkr/r2modmanPlus) was used only as a format reference. No code was copied.
- Conclusion: commercial use is not prohibited, but it is not authorized either. Before charging, ask Thunderstore staff on Discord (https://discord.thunderstore.io) for written permission.
