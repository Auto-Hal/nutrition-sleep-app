-- CR-002: server-side shared login rate-limit state.
-- The key is an HMAC fingerprint; raw proxy addresses are never stored.
create table private.login_rate_limits (
  key_hash text primary key check (char_length(key_hash) = 64),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

create index login_rate_limits_updated_at_idx on private.login_rate_limits (updated_at);

alter table private.login_rate_limits enable row level security;
alter table private.login_rate_limits force row level security;
revoke all on table private.login_rate_limits from public, anon, authenticated;

comment on table private.login_rate_limits is 'Server-only shared login throttling state. key_hash is an HMAC and never a raw client address.';
