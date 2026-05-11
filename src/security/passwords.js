const crypto = require("crypto");

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  N: 16384,
  r: 8,
  p: 1
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH, SCRYPT_PARAMS);

  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${key.toString("hex")}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, salt, expectedKeyHex] = parts;
  const expectedKey = Buffer.from(expectedKeyHex, "hex");

  if (expectedKey.length !== KEY_LENGTH) {
    return false;
  }

  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });

  return crypto.timingSafeEqual(key, expectedKey);
}

module.exports = {
  hashPassword,
  verifyPassword
};
