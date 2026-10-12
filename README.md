# Gen X AV

Static marketing site. Open `index.html` in a browser or serve this directory with any static HTTP server.

Homeowners and AV integrators use one shared project intake. The form posts to `/api/intake`, which validates submissions and sends notifications to `matt@genxav.com` through Resend. Email delivery requires `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN` in Vercel; a static local server cannot run the API.

Older local copies are preserved in `Previous-Versions/`, excluded from Git and Vercel deployments.
