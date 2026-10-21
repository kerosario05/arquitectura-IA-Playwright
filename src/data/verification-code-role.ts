/** Shared vocabulary for authentication codes; business authorization tokens are separate. */
export const VERIFICATION_CODE_KEYS = [
  "auth.otp", "otp", "OTP_SECRET", "one_time_code", "verification_code",
  "security_code", "sms_code", "access_code", "codigo_otp", "codigo_verificacion",
  "codigo_de_verificacion", "codigo_acceso", "codigo_de_acceso", "codigo_seguridad",
  "codigo_de_seguridad",
];

export function isVerificationCodeKey(key: string): boolean {
  const normalize = (value: string) => value.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return VERIFICATION_CODE_KEYS.some(alias => normalize(alias) === normalize(key));
}
