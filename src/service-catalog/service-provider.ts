/**
 * Service catalog contract.
 *
 * A catalog service fills a scenario field at run time with a value the test
 * cannot know in advance (an OTP, a token, a verification code). Each service is
 * a provider in code; projects enable it and store their own settings, and
 * scenarios bind it to a field by `valueKey`. Values produced by a provider are
 * always treated as sensitive: never persisted, never logged in full.
 */

export type ServiceCategory = "otp" | "token" | "codigo";

/** A field shown in the per-project settings form of a service. */
export type ServiceSettingDefinition = {
  key: string;
  label: string;
  description?: string;
  kind: "text" | "list" | "environments";
  required: boolean;
};

/** A parameter a scenario binding supplies when it uses the service. */
export type ServiceParamDefinition = {
  key: string;
  label: string;
  description?: string;
  /** `field_ref`: taken from another field of the same scenario (e.g. the cédula). */
  kind: "text" | "field_ref" | "select";
  required: boolean;
  options?: string[];
};

export type ServiceDescriptor = {
  key: string;
  name: string;
  category: ServiceCategory;
  description: string;
  /** Where the value comes from, for the catalog card (never a connection string). */
  source: string;
  output: { kind: "code"; length?: number; segmented: boolean };
  settings: ServiceSettingDefinition[];
  params: ServiceParamDefinition[];
};

/** Whether the server can run the service right now, independent of any project. */
export type ServiceAvailability = {
  available: boolean;
  /** Short, user-facing reasons it cannot run (empty when available). */
  reasons: string[];
  environment: string;
};

export type ServiceResolveContext = {
  projectSlug: string;
  settings: Record<string, unknown>;
  /** ISO time from which a value counts as fresh (step-time resolution). */
  generatedAfter?: string;
};

export type ServiceResolveResult = {
  value: string;
  /** Non-sensitive facts for logs and evidence (channel, source, duration). */
  meta: Record<string, string | number | boolean>;
};

export class ServiceCatalogError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "ServiceCatalogError";
  }
}

export interface ServiceProvider {
  readonly descriptor: ServiceDescriptor;
  availability(env?: NodeJS.ProcessEnv): ServiceAvailability;
  /** Validates and canonicalizes per-project settings; throws ServiceCatalogError(400). */
  normalizeSettings(input: unknown): Record<string, unknown>;
  resolve(context: ServiceResolveContext, params: Record<string, unknown>): Promise<ServiceResolveResult>;
}
