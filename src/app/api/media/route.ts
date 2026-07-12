import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";

const UPLOAD_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "uploads");
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
]);

export async function POST(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("file required");

  if (!ALLOWED.has(file.type)) {
    return jsonError("Unsupported media type. Use jpeg, png, webp, gif, or mp4.");
  }

  if (file.size > 15 * 1024 * 1024) {
    return jsonError("File too large (max 15MB for this app)");
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.name) || mimeExt(file.type);
  const filename = `${Date.now()}-${randomUUID()}${ext}`;
  const relative = path.join("data", "uploads", filename);
  const absolute = path.join(/*turbopackIgnore: true*/ process.cwd(), relative);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absolute, buffer);

  return jsonOk({ path: relative, filename, type: file.type, size: file.size });
}

function mimeExt(type: string) {
  switch (type) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    default:
      return "";
  }
}
