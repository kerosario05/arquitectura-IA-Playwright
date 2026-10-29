import { createOracleOtpProvider } from "./providers/otp-oracle-local-token";
import { ServiceCatalogError, type ServiceProvider } from "./service-provider";

/**
 * The catalog itself: every service a project can enable. Services are code,
 * so adding one means adding its provider here; projects only store settings.
 */
const PROVIDERS: ServiceProvider[] = [createOracleOtpProvider()];

export function listServiceProviders(): ServiceProvider[] {
  return PROVIDERS;
}

export function findServiceProvider(key: string): ServiceProvider | null {
  return PROVIDERS.find((provider) => provider.descriptor.key === key) ?? null;
}

export function getServiceProvider(key: string): ServiceProvider {
  const provider = findServiceProvider(key);
  if (!provider) throw new ServiceCatalogError("service_not_found", 404, `El servicio "${key}" no existe en el catálogo.`);
  return provider;
}
