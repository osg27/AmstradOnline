# Supporter UI temporarily hidden

`frontend/src/config/supporterUi.js` sets `SUPPORTER_UI_ENABLED = false`.

This hides Supporter badges, upgrade copy and locked feature previews. Protected
room creation is hidden for everyone, including admins and entitled accounts;
the lobby always creates normal rooms while this flag is off. Existing protected
rooms and their admission rules remain unchanged. Other features remain available
to entitled accounts with ordinary labels. Accounts
without access are not offered protected-room creation, larger session sizes,
tournament creation, recording or locked avatars. Joining rooms/tournaments and
managing tournaments already owned are unchanged.

Backend checks, entitlements, plans and all original Supporter components remain
in place. This presentation switch does not grant access or alter hosting limits.
Entitlement denials use neutral frontend wording while it is off.

To restore the UI, change the constant to `true`, rebuild and deploy the frontend.
No database migration or backend deployment is required.
