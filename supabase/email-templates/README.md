# Email templates

The emails Supabase Auth sends, branded for JAMC Davao Connect. Supabase does
not read these files: paste each one into **Supabase Dashboard → Authentication
→ Emails → Templates**.

| Template in Supabase | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | Confirm your email for JAMC Davao Connect |
| Invite user | `invite.html` | You're invited to JAMC Davao Connect |
| Reset password | `reset-password.html` | Reset your JAMC Davao Connect password |
| Change email address | `change-email.html` | Confirm your new email for JAMC Davao Connect |

## How the links work

Each button points to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=…`.
`RedirectTo` is the address the app asked for (for example
`https://jamc-davao-connect.vercel.app/auth/confirm?next=/pending-approval`), and
`/auth/confirm` exchanges the token for a session. Unlike the default
`{{ .ConfirmationURL }}`, this works when the email is opened on a different
device from the one used to sign up.

This depends on the app's address being allowed under **Authentication → URL
Configuration → Redirect URLs** (`https://jamc-davao-connect.vercel.app/**`).
If it is not allowed, Supabase replaces `RedirectTo` with the Site URL and the
link breaks.

## Sender name

The built-in Supabase email service always sends as "Supabase Auth" and allows
only a few emails per hour. To send as "JAMC Davao Connect", set up custom SMTP
under **Authentication → Emails → SMTP Settings** and use "JAMC Davao Connect"
as the sender name.
