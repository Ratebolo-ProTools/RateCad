export {};

declare global {
  interface Window {
    ratecadDesktop?: {
      platform: string;
      onMenuAction: (handler: (action: string) => void) => () => void;
      /** P3-B4B2B — subscribe to main-process exit preparation requests. */
      onPrepareExit?: (handler: (requestId: number) => void) => () => void;
      respondExitPreparation?: (payload: {
        requestId: number;
        status: 'approved' | 'canceled' | 'failed';
        reason?: string;
      }) => Promise<{ ok?: boolean; ignored?: boolean; closed?: boolean }>;
      openDrawing: () => Promise<{
        canceled?: boolean;
        filePath?: string;
        contents?: string;
        error?: string;
      }>;
      openDrawingPath?: (filePath: string) => Promise<{
        canceled?: boolean;
        filePath?: string;
        contents?: string;
        error?: string;
      }>;
      saveDrawing: (payload: {
        contents: string;
        filePath?: string | null;
        defaultPath?: string;
        forceDialog?: boolean;
      }) => Promise<{
        canceled?: boolean;
        filePath?: string;
        error?: string;
      }>;
      quickSave: (payload: {
        contents: string;
        preferredName?: string;
      }) => Promise<{
        canceled?: boolean;
        filePath?: string;
        error?: string;
      }>;
      quitApp?: () => Promise<{ ok?: boolean; error?: string }>;
    };
  }
}
