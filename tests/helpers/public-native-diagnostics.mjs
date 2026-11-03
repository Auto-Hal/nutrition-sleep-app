// WebKit can report handled, cancelled Next prefetch/SW requests as native
// pageerrors. Real JS errors are monitored independently; every affected RSC
// endpoint must also succeed in an explicit fresh read before it is classified.
export function publicNativeCancellationKind(message) {
  if (/^\/127\.0\.0\.1:3198\/sw\.js\?v=development due to access control checks\.$/.test(message)) return "worker";
  if (/^\/127\.0\.0\.1:3198\/(?:today|nutrition|body|sleep|settings)\?_rsc=[A-Za-z0-9_-]+ due to access control checks\.$/.test(message)) return "prefetch";
  return null;
}
