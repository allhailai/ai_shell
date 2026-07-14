import { describe, expect, it } from "vitest";
import { canAccessApp } from "./appAccess";
import type { AppManifest } from "../types/app";

const content = () => null;
const settings: AppManifest = { id: "settings", name: "Settings", mainContent: content };
const administration: AppManifest = { id: "admin", name: "Administration", requiresAdmin: true, mainContent: content };

describe("shell app access", () => {
  it("keeps Settings available to regular authenticated users and gates Administration", () => {
    const regular = { username: "regular", firstname: "", lastname: "", is_admin: false, is_system: false };
    expect(canAccessApp(settings, regular)).toBe(true);
    expect(canAccessApp(administration, regular)).toBe(false);
    expect(canAccessApp(administration, { ...regular, is_admin: true })).toBe(true);
  });
});
