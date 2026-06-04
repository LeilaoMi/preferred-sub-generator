export async function writeKvValue({ accountId, namespaceId, apiToken, key, value, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: typeof value === "string" ? value : JSON.stringify(value),
    },
  );

  if (!response.ok) {
    throw new Error(`Cloudflare KV write failed for ${key}: ${response.status}`);
  }
}

export async function readKvValue({ accountId, namespaceId, apiToken, key, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Cloudflare KV read failed for ${key}: ${response.status}`);
  }
  return response.text();
}

export async function deleteKvValue({ accountId, namespaceId, apiToken, key, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
    },
  );

  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(`Cloudflare KV delete failed for ${key}: ${response.status}`);
  }
}
