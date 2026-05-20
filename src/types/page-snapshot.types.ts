export type SnapshotElementType =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "table"
  | "dialog"
  | "heading"
  | "text"
  | "image"
  | "section"
  | "card"
  | "unknown";

export type CandidateLocator = {
  strategy: "role" | "text" | "label" | "placeholder" | "testId" | "css" | "xpath";
  value?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  confidence: number;
};

export type SnapshotElement = {
  id: string;
  type: SnapshotElementType;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  role?: string;
  tagName?: string;
  inputType?: string;
  required?: boolean;
  disabled?: boolean;
  visible: boolean;
  nearbyText?: string;
  candidateLocators: CandidateLocator[];
  dataHints: string[];
  href?: string;
  ariaLabel?: string;
  title?: string;
  alt?: string;
  dataTestid?: string;
  className?: string;
  domId?: string;
};

export type PageSnapshot = {
  version: "1.0";
  url: string;
  title: string;
  capturedAt: string;
  elements: SnapshotElement[];
  summary: {
    totalElements: number;
    buttons: number;
    links: number;
    inputs: number;
    selects: number;
    tables: number;
    dialogs: number;
    headings: number;
  };
};
