export type RegistryLocatorStrategy = "role" | "text" | "label" | "placeholder" | "testId" | "css" | "xpath";

export type RegistryLocator = {
  strategy: RegistryLocatorStrategy;
  value?: string;
  role?: string;
  name?: string;
  exact?: boolean;
};

export type RegistryObjectType =
  | "page"
  | "section"
  | "button"
  | "link"
  | "input"
  | "select"
  | "checkbox"
  | "radio"
  | "table"
  | "text"
  | "modal"
  | "menu"
  | "card"
  | "unknown";

export type RegistryObject = {
  key: string;
  name: string;
  description?: string;
  type: RegistryObjectType;
  locator: RegistryLocator;
  aliases?: string[];
  required?: boolean;
  stable?: boolean;
  tags?: string[];
};

export type ObjectRegistry = {
  version: "1.0";
  appName?: string;
  baseUrlPattern?: string;
  objects: RegistryObject[];
  createdAt?: string;
  updatedAt?: string;
};

export type ObjectRegistryValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  objectKey?: string;
};

export type ObjectRegistryValidationResult = {
  valid: boolean;
  issues: ObjectRegistryValidationIssue[];
};
