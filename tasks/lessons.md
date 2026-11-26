# Lessons

- When guiding through a third-party UI (e.g. the Claude Console), don't give click paths from memory; they change. Start from the screen the user actually sees, explain which option fits *their* setup and why, and go one screen at a time.
- External services the user already owns and has deployed (e.g. human-atlas) are out of scope. Treat them as fixed dependencies. Don't propose changes to their hosting or architecture unless asked. Check their deployed config (endpoints, CORS allowlist) and plan around it.
