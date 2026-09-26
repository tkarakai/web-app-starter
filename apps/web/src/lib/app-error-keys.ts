/**
 * The app's Convex error codes and the message keys that translate them. The platform's
 * own codes (rate limits, sessions, connection) are handled by `ConvexErrorToast`.
 */
export const APP_ERROR_KEYS: Readonly<Record<string, string>> = {
  PROJECT_NOT_FOUND: "sampleErrors.projectNotFound",
  TASK_NOT_FOUND: "sampleErrors.taskNotFound",
  FILE_NOT_FOUND: "sampleErrors.fileNotFound",
  FILE_TOO_LARGE: "sampleErrors.fileTooLarge",
  UPLOAD_NOT_FOUND: "sampleErrors.uploadNotFound",
};
