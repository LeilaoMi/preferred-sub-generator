export function isAuthorized(request, env) {
  const expected = env?.SUB_TOKEN;
  if (!expected) return false;

  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken === expected) return true;

  const authorization = request.headers.get("Authorization") || "";
  return authorization === `Bearer ${expected}`;
}
