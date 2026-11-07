export function samePageSurface(previousUrl: string, currentUrl: string): boolean {
  try {
    const previous = new URL(previousUrl);
    const current = new URL(currentUrl);
    return previous.origin === current.origin
      && previous.pathname === current.pathname
      && previous.hash === current.hash;
  } catch {
    return previousUrl === currentUrl;
  }
}

export function shouldClearActiveContainer(containerUrl: string | undefined, currentUrl: string): boolean {
  return Boolean(containerUrl && !samePageSurface(containerUrl, currentUrl));
}
