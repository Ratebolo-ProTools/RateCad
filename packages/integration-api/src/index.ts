/**
 * Future RateBolo integration contracts.
 *
 * RateCAD must remain independent. Integration will happen only through
 * these well-defined API shapes — never by importing RateBolo code.
 *
 * Milestone 1: type stubs only. No network calls. No RateBolo dependency.
 */

export interface RateboloProjectRef {
  projectId: string;
  projectName?: string;
}

export interface QuantityExportPayload {
  source: 'ratecad';
  drawingName: string;
  exportedAt: string;
  items: Array<{
    category: string;
    description: string;
    quantity: number;
    unit: string;
  }>;
}

export interface RateboloIntegrationClient {
  /** Link a drawing to a RateBolo project (future). */
  linkProject(ref: RateboloProjectRef): Promise<void>;
  /** Push quantity takeoff to RateBolo (future). */
  pushQuantities(payload: QuantityExportPayload): Promise<void>;
}

export class IntegrationNotImplementedError extends Error {
  constructor() {
    super(
      'RateBolo integration is not implemented. Reserved for Milestone 12.',
    );
    this.name = 'IntegrationNotImplementedError';
  }
}
