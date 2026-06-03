export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function textResponse(text, contentType = "text/plain; charset=utf-8") {
  return new Response(text, {
    headers: {
      "Content-Type": contentType,
    },
  });
}

export function unauthorizedResponse() {
  return jsonResponse({ error: "Unauthorized" }, 401);
}
