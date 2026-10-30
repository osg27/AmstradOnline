# RetroAchievements public profiles

This first integration displays a public RetroAchievements username, points and
up to ten recent unlocks from the past seven days on the player's Profile page.
It does not verify ownership of that public username, log players into an emulator,
evaluate game memory, award achievements, or enable hardcore mode. Existing site
achievements remain separate.

## Setup

1. Obtain a Web API key from your RetroAchievements account control panel:
   https://retroachievements.org/controlpanel.php
2. Set `RETROACHIEVEMENTS_API_KEY` in the backend deployment environment or `.env`.
   Do not put the value in any `VITE_` variable, frontend file, or repository.
3. Restart/recreate the backend so the new environment variable is loaded.
   For the supplied Compose deployment: `docker compose up -d --force-recreate backend`.
4. Open Profile, enter the public RetroAchievements username, and save.

No key is required to save/remove the username. Until the administrator configures
the key, the card explains that syncing is pending. A failed upstream lookup does
not prevent the rest of the player's profile loading. Once an account is resolved,
its ULID is stored to follow username changes.

## Requests and storage

- Authenticated routes: `GET/PATCH /auth/profile/retroachievements`.
- Uses `API_GetUserProfile.php` and `API_GetUserRecentAchievements.php`.
- All Web API requests originate on the backend. Redirects are rejected, errors
  are sanitized, responses are bounded to 2 MB, and requests time out after 10 seconds.
- Five-minute, 256-entry process-local cache, four concurrent upstream requests,
  and a shared limit of 60 upstream requests per minute.
- New nullable user fields are added by the existing startup migration helper.
- Avatar and badge images are requested directly from RetroAchievements without
  a referrer. Links open the public RetroAchievements pages.

The API key is not stored in the user table or returned to the browser. Removing
the profile clears both the saved username and ULID, without calling upstream.

Official documentation: https://api-docs.retroachievements.org/
