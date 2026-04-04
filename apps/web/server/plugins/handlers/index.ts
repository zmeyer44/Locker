import { registerHandler } from "../runtime";
import { qmdSearchHandler } from "./qmd-search";
import { ftsSearchHandler } from "./fts-search";
import { googleDriveHandler } from "./google-drive";
import { documentTranscriptionHandler } from "./document-transcription";

export function registerBuiltinHandlers(): void {
  registerHandler(qmdSearchHandler);
  registerHandler(ftsSearchHandler);
  registerHandler(googleDriveHandler);
  registerHandler(documentTranscriptionHandler);
}

// Auto-register on import
registerBuiltinHandlers();
