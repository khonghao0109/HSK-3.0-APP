const parseJwtSecrets = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(process.env.JWT_SECRETS ?? '{}') as Record<
      string,
      string
    >;

    return parsed;
  } catch {
    return {};
  }
};

export default () => ({
  jwt: {
    secrets: parseJwtSecrets(),
    activeKid: process.env.JWT_ACTIVE_KID ?? 'v1',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
});
