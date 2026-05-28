import type { AdfDocument, AdfNode } from "../types/jira.types";

export function extractTextFromAdf(doc: AdfDocument | string | null | undefined): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc.trim();
  if (typeof doc !== "object" || (doc as AdfDocument).type !== "doc") return "";
  return extractNodes((doc as AdfDocument).content ?? []).trim();
}

function extractNodes(nodes: AdfNode[]): string {
  return nodes.map(extractNode).join("");
}

function extractNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "paragraph":
      return extractNodes(node.content ?? []) + "\n";
    case "heading":
      return extractNodes(node.content ?? []) + "\n";
    case "bulletList":
      return (node.content ?? [])
        .map((item) => `- ${extractNodes(item.content ?? []).trim()}`)
        .join("\n") + "\n";
    case "orderedList":
      return (node.content ?? [])
        .map((item, i) => `${i + 1}. ${extractNodes(item.content ?? []).trim()}`)
        .join("\n") + "\n";
    case "listItem":
      return extractNodes(node.content ?? []);
    case "blockquote":
    case "codeBlock":
    case "panel":
      return extractNodes(node.content ?? []) + "\n";
    case "rule":
      return "\n";
    case "mediaSingle":
    case "media":
    case "mention":
    case "emoji":
      return "";
    default:
      return node.content ? extractNodes(node.content) : (node.text ?? "");
  }
}
