/**
 * Formats a message label for display.
 * This is intentionally tiny but gives us a clear example for unit tests.
 */
export function formatMessageLabel(author: string, body: string) {
  return `${author.trim()}: ${body.trim()}`;
}
