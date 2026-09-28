import { registerPlugin } from '@capacitor/core';

export interface SaveSharedDocumentOptions {
  base64Data: string;
  fileName: string;
  mimeType?: string;
  subdirectory?: string;
}

export interface SaveSharedDocumentResult {
  fileName: string;
  relativePath: string;
  uri: string;
  isPublicLocation?: boolean;
}

export interface SharedDocumentsPlugin {
  saveFile(options: SaveSharedDocumentOptions): Promise<SaveSharedDocumentResult>;
}

export const SharedDocuments = registerPlugin<SharedDocumentsPlugin>('SharedDocuments');
