const hintMap: Array<{ token: string; normalized: string }> = [
  { token: "cédula", normalized: "cedula" },
  { token: "cedula", normalized: "cedula" },
  { token: "documento", normalized: "documento" },
  { token: "identificación", normalized: "identificacion" },
  { token: "identificacion", normalized: "identificacion" },
  { token: "código", normalized: "codigo" },
  { token: "codigo", normalized: "codigo" },
  { token: "otp", normalized: "otp" },
  { token: "pin", normalized: "pin" },
  { token: "token", normalized: "token" },
  { token: "teléfono", normalized: "telefono" },
  { token: "telefono", normalized: "telefono" },
  { token: "celular", normalized: "celular" },
  { token: "mobile", normalized: "telefono" },
  { token: "phone", normalized: "telefono" },
  { token: "monto", normalized: "monto" },
  { token: "importe", normalized: "monto" },
  { token: "amount", normalized: "monto" },
  { token: "valor", normalized: "monto" },
  { token: "cuenta", normalized: "cuenta" },
  { token: "account", normalized: "cuenta" },
  { token: "préstamo", normalized: "prestamo" },
  { token: "prestamo", normalized: "prestamo" },
  { token: "loan", normalized: "prestamo" },
  { token: "cliente", normalized: "cliente" },
  { token: "customer", normalized: "cliente" },
  { token: "email", normalized: "email" },
  { token: "correo", normalized: "email" },
  { token: "usuario", normalized: "usuario" },
  { token: "username", normalized: "usuario" },
  { token: "user", normalized: "usuario" },
  { token: "password", normalized: "password" },
  { token: "contraseña", normalized: "password" },
  { token: "clave", normalized: "password" }
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDataHintsFromElementText(text: string): string[] {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const result = new Set<string>();
  for (const hint of hintMap) {
    if (normalizedText.includes(normalizeText(hint.token))) {
      result.add(hint.normalized);
    }
  }

  return Array.from(result);
}
