import {
  SCHEMA_VERSION,
  type DrawingDocument,
} from '@ratecad/core';

export const RATECAD_FILE_EXTENSION = '.ratecad';

export interface RatecadFile {
  format: 'ratecad';
  schemaVersion: number;
  document: Omit<DrawingDocument, 'selection'>;
}

export function serializeDocument(doc: DrawingDocument): string {
  const file: RatecadFile = {
    format: 'ratecad',
    schemaVersion: doc.schemaVersion,
    document: {
      schemaVersion: doc.schemaVersion,
      meta: doc.meta,
      settings: doc.settings,
      layers: doc.layers,
      entities: doc.entities,
    },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseDocument(text: string): DrawingDocument {
  const parsed = JSON.parse(text) as RatecadFile;
  if (parsed.format !== 'ratecad') {
    throw new Error('Not a RateCAD file');
  }
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema version ${parsed.schemaVersion} (app supports ${SCHEMA_VERSION})`,
    );
  }
  return {
    ...parsed.document,
    selection: [],
  };
}
