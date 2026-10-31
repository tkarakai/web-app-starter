import { describe, expect, test } from "bun:test";

import { organizationErrorKey, organizationSlug } from "../../src/lib/organization";

describe("organizationErrorKey", () => {
  test("maps Better Auth organization errors to message keys", () => {
    expect(organizationErrorKey({ status: 429 })).toBe("rateLimited");
    expect(organizationErrorKey({ status: 400, code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" })).toBe("lastOwner");
    expect(organizationErrorKey({ status: 400, code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER" })).toBe("lastOwner");
    expect(organizationErrorKey({ status: 400, code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION" })).toBe("alreadyMember");
    expect(organizationErrorKey({ status: 400, code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION" })).toBe("alreadyMember");
    expect(organizationErrorKey({ status: 403, code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE" })).toBe("notAllowed");
    expect(organizationErrorKey({ status: 500 })).toBe("generic");
    expect(organizationErrorKey(null)).toBe("generic");
  });
});

describe("organizationSlug", () => {
  test("is a readable, URL-safe prefix with a random suffix", () => {
    const slug = organizationSlug("Ünïcode & Co. — Labs!");
    expect(slug).toMatch(/^unicode-co-labs-[a-z0-9]+$/);
    expect(organizationSlug("Same")).not.toBe(organizationSlug("Same"));
    expect(organizationSlug("!!!")).toMatch(/^org-[a-z0-9]+$/);
  });
});
