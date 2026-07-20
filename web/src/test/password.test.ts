import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Account password hashing tests — the foundation of "never accept a
 * wrong current password" across the app.
 */

test("hash + verify roundtrip accepts the correct password", async () => {
  const rec = await hashPassword("s3cret-Pa55!");
  expect(rec.hash.length).toBeGreaterThan(0);
  expect(rec.salt.length).toBeGreaterThan(0);
  await expect(verifyPassword("s3cret-Pa55!", rec.salt, rec.hash)).resolves.toBe(true);
});

test("a wrong password is always rejected", async () => {
  const rec = await hashPassword("correct-password");
  await expect(verifyPassword("incorrect-password", rec.salt, rec.hash)).resolves.toBe(false);
  await expect(verifyPassword("", rec.salt, rec.hash)).resolves.toBe(false);
  await expect(verifyPassword("correct-password ", rec.salt, rec.hash)).resolves.toBe(false);
});

test("the same password gets a unique salt and hash every time", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  expect(a.salt).not.toBe(b.salt);
  expect(a.hash).not.toBe(b.hash);
  // Both still verify independently.
  await expect(verifyPassword("same-password", a.salt, a.hash)).resolves.toBe(true);
  await expect(verifyPassword("same-password", b.salt, b.hash)).resolves.toBe(true);
});

test("hashing with an explicit salt is deterministic", async () => {
  const first = await hashPassword("stable", undefined);
  const second = await hashPassword("stable", first.salt);
  expect(second.hash).toBe(first.hash);
  expect(second.salt).toBe(first.salt);
});

test("malformed stored data never verifies", async () => {
  await expect(verifyPassword("x", "", "")).resolves.toBe(false);
  await expect(verifyPassword("x", "not-base64!!!", "###")).resolves.toBe(false);
});
