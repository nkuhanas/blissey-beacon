import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export type VerifyOperator = (token: string) => Promise<string>;
export function createOperatorVerifier(
  issuer: string,
  audience = "authenticated",
  key?: JWTVerifyGetKey | CryptoKey | Uint8Array,
): VerifyOperator {
  const keys =
    key ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (
      payload.role !== "authenticated" ||
      !payload.sub ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payload.sub,
      )
    )
      throw new Error("Invalid operator claims");
    return payload.sub;
  };
}
