import { generateVlessUri } from "./vless.js";

export function generateShadowrocketSubscription(template, nodes) {
  return nodes
    .map((node, index) => generateVlessUri(template, { name: `优选-${index + 1}`, ...node }))
    .join("\n");
}
