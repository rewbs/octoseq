import { describe, expect, it } from "vitest";
import { canReadAsset, type AssetAccessRecord } from "./assetAccess";

function asset(
  ownerId: string | null,
  projects: Array<{ ownerId: string; isPublic: boolean }> = [],
  snapshots: Array<{ ownerId: string; isPublic: boolean }> = []
): AssetAccessRecord {
  return {
    ownerId,
    projects: projects.map((project) => ({ project })),
    snapshots: snapshots.map((project) => ({ snapshot: { project } })),
  };
}

describe("canReadAsset", () => {
  it("allows the uploader", () => {
    expect(canReadAsset("owner", asset("owner"))).toBe(true);
  });

  it("allows anonymous access only through a public project", () => {
    expect(canReadAsset(null, asset("owner", [{ ownerId: "owner", isPublic: true }]))).toBe(true);
    expect(canReadAsset(null, asset("owner", [{ ownerId: "owner", isPublic: false }]))).toBe(false);
  });

  it("allows the owner of a private clone that references the asset", () => {
    expect(
      canReadAsset(
        "clone-owner",
        asset("source-owner", [{ ownerId: "clone-owner", isPublic: false }])
      )
    ).toBe(true);
  });

  it("retains access through immutable snapshot references", () => {
    expect(canReadAsset("owner", asset(null, [], [{ ownerId: "owner", isPublic: false }]))).toBe(
      true
    );
    expect(canReadAsset(null, asset(null, [], [{ ownerId: "owner", isPublic: true }]))).toBe(true);
  });

  it("rejects unrelated authenticated users", () => {
    expect(canReadAsset("stranger", asset("owner", [{ ownerId: "owner", isPublic: false }]))).toBe(
      false
    );
  });
});
