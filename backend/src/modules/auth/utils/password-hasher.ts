import * as argon2 from 'argon2';

export async function hashPasswordWithPepper(
  password: string,
  pepper: string,
): Promise<string> {
  const passwordWithPepper = `${password}${pepper}`;

  return argon2.hash(passwordWithPepper, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPasswordWithPepper(
  password: string,
  hash: string,
  pepper: string,
): Promise<boolean> {
  if (!hash.startsWith('$argon2id$')) {
    return false;
  }

  try {
    return await argon2.verify(hash, `${password}${pepper}`);
  } catch {
    return false;
  }
}
