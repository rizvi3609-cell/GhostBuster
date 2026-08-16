# Decision 0001: Cookie-aware Supabase SSR auth client

## Status

Accepted for Phase 3.

## Context

The original client rule described a service-role server client and an anon browser client reserved for Realtime. Supabase Auth in Next.js middleware and Server Actions also requires an anon-key client with request-cookie adapters. Reusing the browser singleton on the server would mix trust boundaries, while using the service-role client for password login would give authentication code unnecessary privilege.

## Decision

Add `lib/supabase/auth-server.ts`, a request-scoped, cookie-aware client created with the public Supabase URL and anon key. It is used only for `auth.getUser`, password login, token refresh, and sign-out.

The credential boundary remains two-tiered:

- `lib/supabase/server.ts`: service role, server-only database work.
- Anon-key clients:
  - `lib/supabase/auth-server.ts`: server-side Auth with cookies.
  - `lib/supabase/client.ts`: browser-side Realtime only.

No service-role credential enters middleware or browser code.

## Consequences

- Middleware can refresh sessions and protect routes using `auth.getUser()`.
- Server Actions can authenticate before any service-role database query.
- The browser Realtime client remains unused for login and mutations.
- Auth and database clients must never be interchanged.
